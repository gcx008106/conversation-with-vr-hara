/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var express = require('express');
var app = express();
var fs = require('fs');
var extend = require('extend');
var path = require('path');
var async = require('async');
var watson = require('watson-developer-cloud');
var uuid = require('uuid');
var bundleUtils = require('./config/bundle-utils');
var os = require('os');
// from conversation
var bodyParser = require('body-parser'); // parser for post requests
var Conversation = require('watson-developer-cloud/conversation/v1'); // watson sdk

var ONE_HOUR = 3600000;
var TWENTY_SECONDS = 20000;

// Bootstrap application settings
require('./config/express')(app);

// Create the service wrapper
// If no API Key is provided here, the watson-developer-cloud@2.x.x library will check for an VISUAL_RECOGNITION_API_KEY
// environment property and then fall back to the VCAP_SERVICES property provided by Bluemix.
var visualRecognition = new watson.VisualRecognitionV3({
  api_key: '81fc32afd6d4099e843756062a4c9afec035a73a',
  version_date: '2015-05-19'
});


// Create the service wrapper
var conversation = new Conversation({
  // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  username: '96ed59fb-76c5-41cf-a293-c4424f16db7f',
  password: 'WEUqOb67HnwB',
  url: 'https://gateway.watsonplatform.net/conversation/api',
  //WORKSPACE_ID=cc5d1593-8802-4126-9793-c47da9b6c39d
  version_date: Conversation.VERSION_DATE_2017_04_21
});


/// Discovery 
const queryBuilder = require('./query-builder');

//const NEWS_ENVIRONMENT_ID = 'system';
//const NEWS_COLLECTION_ID = 'news';

//Discovery-Demo-hara:SmaProto
const ENVIRONMENT_ID = 'b9c6ac08-1e20-4129-83d9-9c4e14116fb2';
const COLLECTION_ID = 'a0c4668a-954b-4a44-a480-b89ed93b6a70';

const DiscoveryV1 = require('watson-developer-cloud/discovery/v1');
const discovery = new DiscoveryV1({
  // If unspecified here, the DISCOVERY_USERNAME and
  // DISCOVERY_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  username: '630e6f15-ab51-46cb-be96-86b1676be38b',
  password: 'zRaiH4aoOORw',

  version_date: '2017-08-01',
  qs: { aggregation: `[${queryBuilder.aggregations.join(',')}]` },
}); 



app.get('/', function(req, res) {
  res.render('use', {
    bluemixAnalytics: process.env.BLUEMIX_ANALYTICS
  });
});

// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  // Send the input to the conversation service
  conversation.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }
    return res.json(updateMessage(payload, data));
  });
});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Conversation service
 * @param  {Object} response The response from the Conversation service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}



var scoreData = function(score) {
  var scoreColor;
  if (score >= 0.8) {
    scoreColor = '#b9e7c9';
  } else if (score >= 0.6) {
    scoreColor = '#f5d5bb';
  } else {
    scoreColor = '#f4bac0';
  }
  return { score: score, xloc: (score * 312.0), scoreColor: scoreColor};
};

app.get('/thermometer', function(req, res) {
  if (typeof req.query.score === 'undefined') {
    return res.status(400).json({ error: 'Missing required parameter: score', code: 400 });
  }
  var score = parseFloat(req.query.score);
  if (score >= 0.0 && score <= 1.0) {
    res.set('Content-type', 'image/svg+xml');
    //res.render('thermometer', scoreData(score));
	//console.log(score);
  } else {
    return res.status(400).json({ error: 'Score value invalid', code: 400 });
  }
});


function deleteUploadedFile(readStream) {
  fs.unlink(readStream.path, function(e) {
    if (e) {
      console.log('error deleting %s: %s', readStream.path, e);
    }
  });
}


/**
 * Parse a base 64 image and return the extension and buffer
 * @param  {String} imageString The image data as base65 string
 * @return {Object}             { type: String, data: Buffer }
 */
function parseBase64Image(imageString) {
  var matches = imageString.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  var resource = {};

  if (matches.length !== 3) {
    return null;
  }

  resource.type = matches[1] === 'jpeg' ? 'jpg' : matches[1];
  resource.data = new Buffer(matches[2], 'base64');
  return resource;
}

/**
 * Classifies an image
 * @param req.body.url The URL for an image either.
 *                     images/test.jpg or https://example.com/test.jpg
 * @param req.file The image file.
 */
app.post('/api/classify', app.upload.single('images_file'), function(req, res) {
  var params = {
    url: null,
    images_file: null
  };

  if (req.file) { // file image
    params.images_file = fs.createReadStream(req.file.path);
  } else if (req.body.url && req.body.url.indexOf('images') === 0) { // local image
    params.images_file = fs.createReadStream(path.join('public', req.body.url));
  } else if (req.body.image_data) {
    // write the base64 image to a temp file
    var resource = parseBase64Image(req.body.image_data);
    var temp = path.join(os.tmpdir(), uuid.v1() + '.' + resource.type);
    fs.writeFileSync(temp, resource.data);
    params.images_file = fs.createReadStream(temp);
  } else if (req.body.url) { // url
    params.url = req.body.url;
  } else { // malformed url
    return res.status(400).json({ error: 'Malformed URL', code: 400 });
  }

  if (params.images_file) {
    delete params.url;
  } else {
    delete params.images_file;
  }
  var methods = [];
  if (req.body.classifier_id || process.env.OVERRIDE_CLASSIFIER_ID) {
    params.classifier_ids = req.body.classifier_id ? [req.body.classifier_id] : [process.env.OVERRIDE_CLASSIFIER_ID];
    methods.push('classify');
  } else {
    params.classifier_ids = ['default', 'food'];
    params.threshold = 0.5; //So the classifers only show images with a confindence level of 0.5 or higher
    methods.push('classify');
    methods.push('detectFaces');
    methods.push('recognizeText');
  }

  // run the 3 classifiers asynchronously and combine the results
  async.parallel(methods.map(function(method) {
    var fn = visualRecognition[method].bind(visualRecognition, params);
    if (method === 'recognizeText' || method === 'detectFaces') {
      return async.reflect(async.timeout(fn, TWENTY_SECONDS));
    } else {
      return async.reflect(fn);
    }
  }), function(err, results) {
    // delete the recognized file
    if (params.images_file && !req.body.url) {
      deleteUploadedFile(params.images_file);
    }

    if (err) {
      console.log(err);
      return res.status(err.code || 500).json(err);
    }
	
	//console.log("results[0]");
	//console.dir(results[0]);

	
    // combine the results
    var combine = results.map(function(result) {
      if (result.value && result.value.length) {
        // value is an array of arguments passed to the callback (excluding the error).
        // In this case, it's the result and then the request object.
        // We only want the result.
        result.value = result.value[0];
      }
      return result;
    }).reduce(function(prev, cur) {
      return extend(true, prev, cur);
    });
	
    if (combine.value) {
      // save the classifier_id as part of the response
      if (req.body.classifier_id) {
        combine.value.classifier_ids = req.body.classifier_id;
      }
      combine.value.raw = {};
      methods.map(function(methodName, idx) {
        combine.value.raw[methodName] = encodeURIComponent(JSON.stringify(results[idx].value));
      });
	  //console.log("combine.value");
	  //console.dir(combine.value);
	  //console.log("stringify(combine.value)");
	  //console.log(JSON.stringify(combine.value));
	  
      res.json(combine.value);
    } else {
      res.status(400).json(combine.error);
    }
  });
});

// setup query endpoint for news
app.post('/api/query', (req, res, next) => {
  //console.log("/api/query1");
  /*const params = Object.assign({}, queryBuilder.build(req.body), {
    environment_id: NEWS_ENVIRONMENT_ID,
    collection_id: NEWS_COLLECTION_ID
  });*/

  const params = Object.assign({}, queryBuilder.build(req.body), {
    environment_id: ENVIRONMENT_ID,
    collection_id: COLLECTION_ID
  });
  
  console.log(JSON.stringify(params));
  
  //console.log("/api/query2");
  discovery.query(params, (error, response) => {
	//console.log("/api/query3");  
    if (error) {
	  //console.log("/api/query4 error");  
      next(error);
    } else {
	  console.log("/api/query5 response="+JSON.stringify(response));  
      res.json(response);
    }
  });
});

// error-handler settings for all other routes
require('./config/error-handler')(app);

module.exports = app;
