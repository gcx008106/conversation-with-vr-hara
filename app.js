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
const queryBuilder = require('./query-builder');

var ONE_HOUR = 3600000;
var TWENTY_SECONDS = 20000;

// Bootstrap application settings
require('./config/express')(app);

// Conversation
var conversation = new Conversation({
  username: process.env.OONVERSATION_USERNAME,
  password: process.env.CONVERSATION_PASSWORD,  
  url: 'https://gateway.watsonplatform.net/conversation/api',
  version_date: Conversation.VERSION_DATE_2017_04_21
});

/// Discovery 
const DiscoveryV1 = require('watson-developer-cloud/discovery/v1');
const discovery = new DiscoveryV1({
  username: process.env.DISCOVERY_USERNAME,
  password: process.env.DISCOVERY_PASSWORD,
  version_date: '2017-08-01',
  qs: { aggregation: `[${queryBuilder.aggregations.join(',')}]` },
}); 

// Visual Recognition
var visualRecognition = new watson.VisualRecognitionV3({
  api_key: process.env.VISUAL_RECOGNITION_API_KEY,
  version_date: '2015-05-19'
});



app.get('/', function(req, res) {
  res.render('use', {
    bluemixAnalytics: process.env.BLUEMIX_ANALYTICS
  });
});


/////////////////////////////////////////////////////////////////////
// Conversation
/////////////////////////////////////////////////////////////////////
app.post('/api/message', function(req, res) {
  var workspace = process.env.CONVERSATION_WORKSPACE_ID;
  if (!workspace) {
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


/////////////////////////////////////////////////////////////////////
// Visual Recognition
/////////////////////////////////////////////////////////////////////

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



/////////////////////////////////////////////////////////////////////
// Discovery
/////////////////////////////////////////////////////////////////////

// setup query endpoint for news
app.post('/api/query', (req, res, next) => {

  //console.log("/api/query1");
  //console.log("/api/query:environment_id="+process.env.DISCOVERY_ENVIRONMENT_ID); 
  //console.log("/api/query:collection_id="+process.env.DISCOVERY_COLLECTION_ID); 
  //console.log("/api/query:req.body="+JSON.stringify(req.body)); 
  const params = Object.assign({}, queryBuilder.build(req.body), {
    environment_id: process.env.DISCOVERY_ENVIRONMENT_ID,
	//configuration_id: process.env.DISCOVERY_CONFIGURATION_ID,
    collection_id: process.env.DISCOVERY_COLLECTION_ID
  });
  
  //console.log("app.post(/api/query):params="+JSON.stringify(params));
  
  //console.log("/api/query2");
  discovery.query(params, (error, response) => {
	//console.log("/api/query3");  
    if (error) {
	  //console.log("/api/query4 error");  
      next(error);
    } else {
	  //console.log("/api/query5 response="+JSON.stringify(response));  
      res.json(response);
    }
  });
});

// error-handler settings for all other routes
require('./config/error-handler')(app);

module.exports = app;
