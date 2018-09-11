import AmplitudeClient from './AmplitudeNodeClient.js'

// maintain for testing backwards compatability
describe('AmplitudeClient', function() {
  var apiKey = '000000'
  var userId = 'user'
  var amplitude

  beforeEach(function() {
    amplitude = new AmplitudeClient()
  })

  it('amplitude object should exist', function() {
    expect(typeof amplitude).toBe('object')
  })

  describe('init', function() {
    it('should make instanceName case-insensitive', function() {
      expect(new AmplitudeClient('APP3')._instanceName).toBe('app3')
      expect(new AmplitudeClient('$DEFAULT_INSTANCE')._instanceName).toBe('$default_instance')
    })

    it('fails on invalid apiKeys', function() {
      amplitude.init(null)
      expect(amplitude.options.apiKey).toBeUndefined()
      expect(amplitude.options.deviceId).toBeUndefined()

      amplitude.init('')
      expect(amplitude.options.apiKey).toBeUndefined()
      expect(amplitude.options.deviceId).toBeUndefined()

      amplitude.init(apiKey)
      expect(amplitude.options.apiKey).toBe(apiKey)
      expect(amplitude.options.deviceId).toHaveLength(37)
    })

    it('should accept userId', function() {
      amplitude.init(apiKey, userId)
      expect(amplitude.options.userId).toBe(userId)
    })

    it('should accept numerical userIds', function() {
      amplitude.init(apiKey, 5)
      expect(amplitude.options.userId).toBe('5')
    })

    it('should generate a random deviceId', function() {
      amplitude.init(apiKey, userId)
      expect(amplitude.options.deviceId).toHaveLength(37)
      expect(amplitude.options.deviceId[36]).toBe('R')
    })

    it('should validate config values', function() {
      var config = {
        apiEndpoint: 100,  // invalid type
        batchEvents: 'True',  // invalid type
        cookieExpiration: -1,   // negative number
        cookieName: '',  // empty string
        eventUploadPeriodMillis: '30', // 30s
        eventUploadThreshold: 0,   // zero value
        bogusKey: false
      }

      amplitude.init(apiKey, userId, config)
      expect(amplitude.options.apiEndpoint).toBe('api.amplitude.com')
      expect(amplitude.options.batchEvents).toBeFalsy()
      expect(amplitude.options.cookieExpiration).toBe(3650)
      expect(amplitude.options.cookieName).toBe('amplitude_id')
      expect(amplitude.options.eventUploadPeriodMillis).toBe(30000)
      expect(amplitude.options.eventUploadThreshold).toBe(30)
      expect(amplitude.options.bogusKey).toBeUndefined()
    })
    
    it('should set language', function() {
      amplitude.setByRequest({
        headers: { 'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,de;q=0.5' }
      })
      amplitude.init(apiKey, userId)
      expect(amplitude.options).toHaveProperty('language')
      expect(amplitude.options.language).not.toBeNull()
    })

    it('should allow language override', function() {
      amplitude.setByRequest({
        headers: { 'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,de;q=0.5' }
      })
      amplitude.init(apiKey, userId, {language: 'en-GB'})
      expect(amplitude.options).toHaveProperty('language', 'en-GB')
    })

    it ('should not run callback if invalid callback', function() {
      amplitude.init(apiKey, userId, null, 'invalid callback')
    })

    it ('should run valid callbacks', function() {
      var counter = 0
      var callback = function() {
        counter++
      }
      amplitude.init(apiKey, userId, null, callback)
      expect(counter).toBe(1)
    })

    it ('should load the device id from url params if configured', function() {
      var deviceId = 'aa_bb_cc_dd'
      amplitude.setByRequest({
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
          'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,de;q=0.5'
        },
        url: '/path/?amp_device_id=aa_bb_cc_dd'
      })
      amplitude.init(apiKey, userId, {deviceIdFromUrlParam: true})
      expect(amplitude.options.deviceId).toBe(deviceId)
    })

    it ('should not load device id from url params if not configured', function() {
      var deviceId = 'aa_bb_cc_dd'
      amplitude.setByRequest({
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
          'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,de;q=0.5'
        },
        url: '/path/?amp_device_id=aa_bb_cc_dd'
      })
      amplitude.init(apiKey, userId, {deviceIdFromUrlParam: false})
      expect(amplitude.options.deviceId).not.toBe(deviceId)
    })

    it ('should prefer the device id in the config over the url params', function() {
      var deviceId = 'dd_cc_bb_aa'
      amplitude.setByRequest({
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36',
          'accept-language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,de;q=0.5'
        },
        url: '/path/?amp_device_id=aa_bb_cc_dd'
      })
      amplitude.init(apiKey, userId, {deviceId, deviceIdFromUrlParam: true})
      expect(amplitude.options.deviceId).toBe(deviceId)
    })

    it('should merge tracking options during parseConfig', function() {
      var trackingOptions = {
        city: false,
        ip_address: false,
        language: false,
        region: true,
      }

      var amplitude2 = new AmplitudeClient('new_app')
      amplitude2.init(apiKey, null, {trackingOptions: trackingOptions})

      // check config loaded correctly
      expect(amplitude2.options.trackingOptions).toEqual({
        city: false,
        country: true,
        device_model: true,
        dma: true,
        ip_address: false,
        language: false,
        os_name: true,
        os_version: true,
        platform: true,
        region: true,
        version_name: true
      })
    })

    it('should pregenerate tracking options for api properties', function() {
      var trackingOptions = {
        city: false,
        ip_address: false,
        language: false,
        region: true,
      }

      var amplitude2 = new AmplitudeClient('new_app')
      amplitude2.init(apiKey, null, {trackingOptions: trackingOptions})

      expect(amplitude2._apiPropertiesTrackingOptions).toEqual({tracking_options: {
        city: false,
        ip_address: false
      }})
    })
  })
})