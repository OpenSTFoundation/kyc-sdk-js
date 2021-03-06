"use strict";

/**
 * Request Manager
 *
 * @module lib/request
 */
const queryString = require('qs')
  , crypto = require('crypto')
  , https = require('https')
  , http = require('http')
  , url = require('url')
;

const rootPrefix = ".."
  , validate = require(rootPrefix + '/lib/validate')
  , version = require(rootPrefix + '/package.json').version
  , httpUserAgent = "ost-kyc-sdk-js " + version
;

let DEBUG = ( "true" === process.env.OST_KYC_SDK_DEBUG );

/**
 * Generate query signature
 * @param {string} resource - API Resource
 * @param {object} queryParams - resource query parameters
 *
 * @return {string} - query parameters with signature
 *
 * @private @static
 */
function  signQueryParams(resource, queryParams, _apiCredentials) {
  const buff = new Buffer.from(_apiCredentials.secret, 'utf8')
    , hmac = crypto.createHmac('sha256', buff);
  hmac.update(resource + "?" + queryParams);
  return queryParams + "&signature=" + hmac.digest('hex');
}


function alphabeticalSort(a, b) {
  return a.localeCompare(b);
}

/**
 * Request Manager constructor
 *
 * @param {object} params
 * @param {string} params.apiKey - api key
 * @param {string} params.apiSecret - api secret
 * @param {string} params.apiEndpoint - version specific api endpoint
 * @param {obj} params.config - configularions like timeout
 *
 * @constructor
 */
const RequestKlass = function(params) {
  const oThis           = this
    , _apiCredentials = {}
  ;

  // Validate API key
  if (validate.isPresent(params.apiKey)) {
    _apiCredentials.key = params.apiKey;
  } else {
    throw new Error('Api key not present.');
  }

  // Validate API secret
  if (validate.isPresent(params.apiSecret)) {
    _apiCredentials.secret = params.apiSecret;
  } else {
    throw new Error('Api secret not present.');
  }

  oThis.apiEndpoint = params.apiEndpoint.replace(/\/$/, "");
  var config = params.config || {};
    oThis.timeOut = config.timeout * 1000 || 15000;

  oThis._formatQueryParams = function (resource, queryParams) {
    const oThis = this;

    queryParams.api_key = _apiCredentials.key;
    queryParams.request_timestamp = Math.round((new Date()).getTime() / 1000);
    var formattedParams = oThis.formatQueryParams(queryParams);
    return signQueryParams(resource, formattedParams, _apiCredentials);
  }
};

RequestKlass.prototype = {

  /**
   * Send get request
   *
   * @param {string} resource - API Resource
   * @param {object} queryParams - resource query parameters
   *
   * @public
   */
  get: function (resource, queryParams) {
    const oThis = this;
    return oThis._send('GET', resource, queryParams);
  },

  /**
   * Send post request
   *
   * @param {string} resource - API Resource
   * @param {object} queryParams - resource query parameters
   *
   * @public
   */
  post: function (resource, queryParams) {
    const oThis = this;
    return oThis._send('POST', resource, queryParams);
  },

  /**
   * Get formatted query params
   *
   * @param {string} resource - API Resource
   * @param {object} queryParams - resource query parameters
   *
   * @return {string} - query parameters with signature
   *
   * @private
   */
  _formatQueryParams: function (resource, queryParams) {
    /**
     Note: This is just an empty function body.
     The Actual code has been moved to constructor.
     Modifying prototype._formatQueryParams will not have any impact.
     **/
  },

  /**
   * Get parsed URL
   *
   * @param {string} resource - API Resource
   *
   * @return {object} - parsed url object
   *
   * @private
   */
  _parseURL: function (resource) {
    const oThis = this;

    return url.parse(oThis.apiEndpoint + resource);
  },

  /**
   * Send request
   *
   * @param {string} requestType - API request type
   * @param {string} resource - API Resource
   * @param {object} queryParams - resource query parameters
   *
   * @private
   */
  _send: function (requestType, resource, queryParams) {
    const oThis = this
      , parsedURL = oThis._parseURL(resource)
      , requestData = oThis._formatQueryParams(resource, queryParams);


    const options = {
      host: parsedURL.hostname,
      port: parsedURL.port,
      path: parsedURL.path,
      method: requestType,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': httpUserAgent
      }
    };

    if (requestType === 'GET' && validate.isPresent(requestData)) {
      options.path = options.path + "?" + requestData;
    }

    if ( DEBUG ) {
      console.log("------------------------------");
      console.log("request OPTIONS \n", JSON.stringify( options ) );
      console.log("requestData \n", requestData );
    }

    return new Promise(async function (onResolve, onReject) {
      var chunkedResponseData = '';

      var request = (parsedURL.protocol === 'https:' ? https : http).request(options, function (response) {

        response.setEncoding('utf8');

        response.on('data', function (chunk) {
          chunkedResponseData += chunk;
        });

        response.on('end', function () {
          var parsedResponse = oThis._parseResponse(chunkedResponseData, response);
          if ( DEBUG ) {
            console.log("parsedResponse \n", JSON.stringify( parsedResponse ) );
            console.log("------------------------------");
          }

          if (parsedResponse.success) {
            onResolve(parsedResponse);
          } else {
            onReject(parsedResponse);
          }
        });

      });

      request.on('socket', function (socket) {
        socket.setTimeout(oThis.timeOut);
        socket.on('timeout', function(e) {
          onReject({"success":false,"err":{"code":"GATEWAY_TIMEOUT","internal_id":"TIMEOUT_ERROR","msg":"","error_data":[]}});
        });
      });

      request.on('error', function (e) {

        console.error('KYC-SDK: Request error');
        console.error(e);
        var parsedResponse = oThis._parseResponse(e);
        if (parsedResponse.success) {
          onResolve(parsedResponse);
        } else {
          onReject(parsedResponse);
        }

      });

      //write data to server
      if (requestType === 'POST' && validate.isPresent(requestData)) {
        request.write(requestData);
      }
      request.end();
    });
  },

  /**
   * Parse response
   *
   * @param {string} responseData - Response data
   * @param { object} response - Response object
   *
   * @private
   */
  _parseResponse: function(responseData, response) {
    var statusesHandledAtServers = [200, 400, 401, 403, 404, 422, 429, 500];
    if (!validate.isPresent(responseData) || statusesHandledAtServers.indexOf((response || {}).statusCode) < 0  ) {
      switch ((response || {}).statusCode) {
        case 502:
          responseData = responseData || '{"success": false, "err": {"code": "BAD_GATEWAY", "internal_id": "SDK(BAD_GATEWAY)", "msg": "", "error_data":[]}}';
          break;
        case 503:
          responseData = responseData || '{"success": false, "err": {"code": "SERVICE_UNAVAILABLE", "internal_id": "SDK(SERVICE_UNAVAILABLE)", "msg": "", "error_data":[]}}';
          break;
        case 504:
          responseData = responseData || '{"success": false, "err": {"code": "GATEWAY_TIMEOUT", "internal_id": "SDK(GATEWAY_TIMEOUT)", "msg": "", "error_data":[]}}';
          break;
        default:
          responseData = responseData || '{"success": false, "err": {"code": "SOMETHING_WENT_WRONG", "internal_id": "SDK(SOMETHING_WENT_WRONG)", "msg": "", "error_data":[]}}';
      }
    }

    try {
      var parsedResponse = JSON.parse(responseData);
    } catch(e) {
      //console.error('KYC-SDK: Response parsing error');
      //console.error(e);
      var parsedResponse = {"success": false, "err": {"code": "SOMETHING_WENT_WRONG", "internal_id": "SDK(SOMETHING_WENT_WRONG)", "msg": "Response parsing error", "error_data":[]}};
    }

    return parsedResponse;
  },

  formatQueryParams: function (queryParams) {
    return this.sanitizeQueryString(queryString.stringify(queryParams,  { sort: alphabeticalSort,  arrayFormat: 'brackets'  }));
  },

  signQueryParamsTest: function (resource, queryParams, _apiCredentials) {
    return signQueryParams(resource, queryParams, _apiCredentials)
  },

  sanitizeQueryString: function (qs) {
    var replaceChars={ '%20':"+", "~": "%7E" },
    regex = new RegExp( Object.keys(replaceChars).join("|"), "g");
    return qs.replace(regex,function(match) {return replaceChars[match];});
  }

};

module.exports = RequestKlass;