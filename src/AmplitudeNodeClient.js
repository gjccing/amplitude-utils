import AmplitudeClient from 'amplitude-js/src/amplitude-client.js'
import utils from 'amplitude-js/src/utils'
import UUID from 'amplitude-js/src/uuid'
import type from 'amplitude-js/src/type'
import DEFAULT_OPTIONS from 'amplitude-js/src/options'
import Constants from 'amplitude-js/src/constants'
import version from 'amplitude-js/src/version'
import UAParser from 'ua-parser-js'
import md5 from 'blueimp-md5'
import axios from 'axios'
import qs from 'query-string'
import _ from 'lodash'

var AmplitudeClientInServer = function AmplitudeClientInServer(instanceName, request) {
  this._instanceName = utils.isEmptyString(instanceName) ? Constants.DEFAULT_INSTANCE : instanceName.toLowerCase()
  this._unsentEvents = []
  this._unsentIdentifys = []
  this._ua = null
  this.options = Object.assign({}, DEFAULT_OPTIONS, { saveEvents: false })
  this._q = [] // queue for proxied functions before script load
  this._sending = false
  this._updateScheduled = false

  // event meta data
  this._eventId = 0
  this._identifyId = 0
  this._lastEventTime = null
  this._newSession = false
  this._sequenceNumber = 0
  this._sessionId = null
  this._userAgent = null

  this.setByRequest(request)
}

AmplitudeClientInServer.prototype = Object.assign({}, AmplitudeClient.prototype, {
  init(apiKey, opt_userId, opt_config, opt_callback) {
    if (type(apiKey) !== 'string' || utils.isEmptyString(apiKey)) {
      utils.log.error('Invalid apiKey. Please re-initialize with a valid apiKey')
      return
    }
  
    try {
      this.options.apiKey = apiKey
      
      _parseConfig(this.options, opt_config)
      var trackingOptions = _generateApiPropertiesTrackingConfig(this)
      this._apiPropertiesTrackingOptions = Object.keys(trackingOptions).length > 0 ? {tracking_options: trackingOptions} : {}

      this.options.deviceId = 
        (type(opt_config) === 'object' && type(opt_config.deviceId) === 'string' &&
          !utils.isEmptyString(opt_config.deviceId) && opt_config.deviceId) ||
        (this.options.deviceIdFromUrlParam && this._getDeviceIdFromUrlParam(this._getUrlParams())) ||
        this.options.deviceId ||
        (UUID() + 'R')
      this.options.userId =
        (type(opt_userId) === 'string' && !utils.isEmptyString(opt_userId) && opt_userId) ||
        (type(opt_userId) === 'number' && opt_userId.toString()) ||
        this.options.userId || null
    } catch (e) {
      utils.log.error(e)
    } finally {
      if (type(opt_callback) === 'function') {
        opt_callback(this)
      }
    }
  },
  regenerateDeviceId() {
    this.setDeviceId(UUID() + 'R')
  },
  setDeviceId(deviceId) {
    if (!utils.validateInput(deviceId, 'deviceId', 'string')) {
      return
    }
  
    try {
      if (!utils.isEmptyString(deviceId)) {
        this.options.deviceId = ('' + deviceId)
      }
    } catch (e) {
      utils.log.error(e)
    }
  },
  setOptOut(enable) {
    if (!utils.validateInput(enable, 'enable', 'boolean')) {
      return
    }

    try {
      this.options.optOut = enable
    } catch (e) {
      utils.log.error(e)
    }
  },
  setUserId(userId) {
    try {
      this.options.userId = (userId !== undefined && userId !== null && ('' + userId)) || null
    } catch (e) {
      utils.log.error(e)
    }
  },
  _logEvent(eventType, eventProperties, apiProperties, userProperties, groups, timestamp, callback) {
    if (!eventType) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'Missing eventType'})
      }
      return
    }
    if (this.options.optOut) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'optOut is set to true'})
      }
      return
    }
  
    try {
      var eventId
      if (eventType === Constants.IDENTIFY_EVENT) {
        eventId = this.nextIdentifyId()
      } else {
        eventId = this.nextEventId()
      }
      var sequenceNumber = this.nextSequenceNumber()
      var eventTime = (type(timestamp) === 'number') ? timestamp : new Date().getTime()
      if (!this._sessionId || !this._lastEventTime || eventTime - this._lastEventTime > this.options.sessionTimeout) {
        this._sessionId = eventTime
      }
      this._lastEventTime = eventTime
  
      userProperties = userProperties || {}
      var trackingOptions = Object.assign({}, this._apiPropertiesTrackingOptions)
      apiProperties = Object.assign(trackingOptions, (apiProperties || {}))
      eventProperties = eventProperties || {}
      groups = groups || {}
      var event = {
        device_id: this.options.deviceId,
        user_id: this.options.userId,
        timestamp: eventTime,
        event_id: eventId,
        session_id: this._sessionId || -1,
        event_type: eventType,
        version_name: _shouldTrackField(this, 'version_name') ? (this.options.versionName || null) : null,
        platform: _shouldTrackField(this, 'platform') ? this.options.platform : null,
        os_name: _shouldTrackField(this, 'os_name') ? (this._ua.browser.name || null) : null,
        os_version: _shouldTrackField(this, 'os_version') ? (this._ua.browser.major || null) : null,
        device_model: _shouldTrackField(this, 'device_model') ? (this._ua.os.name || null) : null,
        language: _shouldTrackField(this, 'language') ? this.options.language : null,
        api_properties: apiProperties,
        event_properties: utils.truncate(utils.validateProperties(eventProperties)),
        user_properties: utils.truncate(utils.validateProperties(userProperties)),
        uuid: UUID(),
        library: {
          name: 'amplitude-js',
          version: version
        },
        sequence_number: sequenceNumber, // for ordering events and identifys
        groups: utils.truncate(utils.validateGroups(groups)),
        user_agent: this._userAgent
      }
  
      if (eventType === Constants.IDENTIFY_EVENT) {
        this._unsentIdentifys.push(event)
        this._limitEventsQueued(this._unsentIdentifys)
      } else {
        this._unsentEvents.push(event)
        this._limitEventsQueued(this._unsentEvents)
      }

      if (!this._sendEventsIfReady(callback) && type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'No events to send or upload queued'})
      }
  
      return eventId
    } catch (e) {
      utils.log.error(e)
    }
  },
  sendEvents(callback) {
    if (!this._apiKeySet('sendEvents()')) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'API key not set'})
      }
      return
    }
    if (this.options.optOut) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'optOut is set to true'})
      }
      return
    }
    if (this._unsentCount() === 0) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'No events to send'})
      }
      return
    }
    if (this._sending) {
      if (type(callback) === 'function') {
        callback(0, 'No request sent', {reason: 'Request already in progress'})
      }
      return
    }
  
    this._sending = true
    var protocol = this.options.forceHttps ? 'https' : ('https:' === window.location.protocol ? 'https' : 'http')
    var url = protocol + '://' + this.options.apiEndpoint + '/'
  
    // fetch events to send
    var numEvents = Math.min(this._unsentCount(), this.options.uploadBatchSize)
    var mergedEvents = this._mergeEventsAndIdentifys(numEvents)
    var maxEventId = mergedEvents.maxEventId
    var maxIdentifyId = mergedEvents.maxIdentifyId
    var events = JSON.stringify(mergedEvents.eventsToSend)
    var uploadTime = new Date().getTime()
  
    var data = {
      client: this.options.apiKey,
      e: events,
      v: Constants.API_VERSION,
      upload_time: uploadTime,
      checksum: md5(Constants.API_VERSION + this.options.apiKey + events + uploadTime)
    }
  
    var scope = this
    axios({
      url,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this._userAgent,
      },
      data: qs.stringify(data),
    })
      .then(( status, data ) => ({ status, data }))
      .catch(({ response: { status, data } }) => ({ status, data }))
      .then(({ status, data: response }) => {
        scope._sending = false
        try {
          if (status === 200 && response === 'success') {
            scope.removeEvents(maxEventId, maxIdentifyId)

            // Send more events if any queued during previous send.
            if (!scope._sendEventsIfReady(callback) && type(callback) === 'function') {
              callback(status, response)
            }

          // handle payload too large
          } else if (status === 413) {
            // utils.log('request too large');
            // Can't even get this one massive event through. Drop it, even if it is an identify.
            if (scope.options.uploadBatchSize === 1) {
              scope.removeEvents(maxEventId, maxIdentifyId)
            }

            // The server complained about the length of the request. Backoff and try again.
            scope.options.uploadBatchSize = Math.ceil(numEvents / 2)
            scope.sendEvents(callback)

          } else if (type(callback) === 'function') { // If server turns something like a 400
            callback(status, response)
          }
        } catch (e) {
          // utils.log('failed upload');
        }
      })
  },
  _getUrlParams () {
    if (this.options.url && this.options.url.indexOf('?') !== -1)
      return this.options.url.match(/\?.+$/)[0]
  },
  getSessionId() {
    utils.log.warn('The `getSessionId` is not implement on server-side')
  },
  isNewSession() {
    utils.log.warn('The `isNewSession` is not implement on server-side. It always return true')
    return true
  },
  logRevenueV2() {
    utils.log.warn('The `logRevenueV2` is not implement on server-side.')
  },
  setDomain() {
    utils.log.warn('The `setDomain` is not implement on server-side.')
  },
  setSessionId() {
    utils.log.warn('The `setSessionId` is not implement on server-side.')
  },

  // addition
  setByRequest(request) {
    const userAgent = _.get(request, 'headers.user-agent')
    this.setUserAgent(userAgent)
    
    let acceptLanguage = _.get(request, 'headers.accept-language')
    const language = acceptLanguage ? acceptLanguage.split(/,\s*/)[0] : null
    this.setLanguage(language)

    let url = _.get(request, 'url')
    this.setUrl(url)
  },
  setUserAgent (userAgent) {
    this._ua = userAgent ? new UAParser(userAgent).getResult() : null
    this._userAgent = userAgent|| null
  },
  setLanguage (language) {
    this.options.language = language
  },
  setUrl (url) {
    this.options.url = url
  },
})

var _shouldTrackField = function _shouldTrackField(scope, field) {
  return !!scope.options.trackingOptions[field]
}

var _parseConfig = function _parseConfig(options, config) {
  if (type(config) !== 'object') {
    return
  }

  // validates config value is defined, is the correct type, and some additional value sanity checks
  var parseValidateAndLoad = function parseValidateAndLoad(key) {
    if (!options.hasOwnProperty(key)) {
      return  // skip bogus config values
    }

    var inputValue = config[key]
    var expectedType = type(options[key])
    if (!utils.validateInput(inputValue, key + ' option', expectedType)) {
      return
    }
    if (expectedType === 'boolean') {
      options[key] = !!inputValue
    } else if ((expectedType === 'string' && !utils.isEmptyString(inputValue)) ||
        (expectedType === 'number' && inputValue > 0)) {
      options[key] = inputValue
    } else if (expectedType === 'object') {
      _parseConfig(options[key], inputValue)
    }
  }

  for (var key in config) {
    if (config.hasOwnProperty(key)) {
      parseValidateAndLoad(key)
    }
  }
}

var _generateApiPropertiesTrackingConfig = function _generateApiPropertiesTrackingConfig(scope) {
  // to limit size of config payload, only send fields that have been disabled
  var fields = ['city', 'country', 'dma', 'ip_address', 'region']
  var config = {}
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i]
    if (!_shouldTrackField(scope, field)) {
      config[field] = false
    }
  }
  return config
}

export default AmplitudeClientInServer
