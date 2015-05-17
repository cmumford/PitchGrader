/*
The MIT License (MIT)

Copyright (c) 2014 Chris Wilson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

var audioContext = null;
var isPlaying = false;
var sourceNode = null;
var analyser = null;
var theBuffer = null;
var DEBUGCANVAS = null;
var mediaStreamSource = null;
var detectorElem, 
    canvasElem,
    waveContext,
    pitchElem,
    noteElem,
    detuneElem,
    detuneAmount;
var canvasRatio;
var frequencyPlot;
var minInputFrequency = 40;
var maxInputFrequency = 3000;
var rawFreqHistory = new Array(300);
var avgFreqHistory = new Array(300);
var numAvgSamples = 5;
var updateNum = 0;


window.onload = function() {
  audioContext = new AudioContext();
  MAX_SIZE = Math.max(4,Math.floor(audioContext.sampleRate/5000));  // corresponds to a 5kHz signal
  var request = new XMLHttpRequest();
  request.open("GET", "../sounds/scale.ogg", true);
  request.responseType = "arraybuffer";
  request.onload = function() {
    audioContext.decodeAudioData( request.response, function(buffer) { 
      theBuffer = buffer;
    } );
  }
  request.send();

  detectorElem = document.getElementById( "detector" );
  canvasElem = document.getElementById( "output" );
  DEBUGCANVAS = document.getElementById( "waveform" );
  if (DEBUGCANVAS) {
    waveContext = DEBUGCANVAS.getContext("2d");
    waveContext.strokeStyle = "black";
    waveContext.lineWidth = 1;

    var devicePixelRatio = window.devicePixelRatio || 1;
    var backingStoreRatio = waveContext.webkitBackingStorePixelRatio ||
                            waveContext.mozBackingStorePixelRatio ||
                            waveContext.msBackingStorePixelRatio ||
                            waveContext.oBackingStorePixelRatio ||
                            waveContext.backingStorePixelRatio || 1;

    canvasRatio = devicePixelRatio / backingStoreRatio;

    // upscale the canvas if the two ratios don't match
    if (devicePixelRatio !== backingStoreRatio) {

        var oldWidth = DEBUGCANVAS.width;
        var oldHeight = DEBUGCANVAS.height;

        DEBUGCANVAS.width = oldWidth * canvasRatio;
        DEBUGCANVAS.height = oldHeight * canvasRatio;

        DEBUGCANVAS.style.width = oldWidth + 'px';
        DEBUGCANVAS.style.height = oldHeight + 'px';

        // now scale the context to counter
        // the fact that we've manually scaled
        // our canvas element
        waveContext.scale(canvasRatio, canvasRatio);
    }
  }
  pitchElem = document.getElementById( "pitch" );
  noteElem = document.getElementById( "note" );
  detuneElem = document.getElementById( "detune" );
  detuneAmount = document.getElementById( "detune_amt" );

  detectorElem.ondragenter = function () { 
    this.classList.add("droptarget"); 
    return false;
  };
  detectorElem.ondragleave = function () { this.classList.remove("droptarget"); return false; };
  detectorElem.ondrop = function (e) {
      this.classList.remove("droptarget");
      e.preventDefault();
    theBuffer = null;

      var reader = new FileReader();
      reader.onload = function (event) {
        audioContext.decodeAudioData( event.target.result, function(buffer) {
          theBuffer = buffer;
        }, function(){alert("error loading!");} ); 

      };
      reader.onerror = function (event) {
        alert("Error: " + reader.error );
      };
      reader.readAsArrayBuffer(e.dataTransfer.files[0]);
      return false;
  };

  frequencyPlot = $.plot("#placeholder", [ getRawFrequencyHistory(), getAvgFrequencyHistory() ], {
    series: {
      shadowSize: 0	// Drawing is faster without shadows
    },
    yaxis: {
      min: 0,
      max: 2000
    },
    xaxis: {
      show: false
    }
  });
}

function error() {
  alert('Stream generation failed.');
}

function getUserMedia(dictionary, callback) {
  try {
    navigator.getUserMedia = 
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;
    navigator.getUserMedia(dictionary, callback, error);
  } catch (e) {
    alert('getUserMedia threw exception :' + e);
  }
}

function gotStream(stream) {
  // Create an AudioNode from the stream.
  mediaStreamSource = audioContext.createMediaStreamSource(stream);

  // Connect it to the destination.
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  mediaStreamSource.connect( analyser );
  updatePitch();
}

function stopPlayback() {
  if (!isPlaying)
    return;
  sourceNode.stop( 0 );
  sourceNode = null;
  analyser = null;
  isPlaying = false;
  if (!window.cancelAnimationFrame)
    window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
  window.cancelAnimationFrame( rafID );
}

function startPrerecorded() {
  stopPlayback();

  sourceNode = audioContext.createBufferSource();
  sourceNode.buffer = theBuffer;
  sourceNode.loop = true;

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  sourceNode.connect( analyser );
  analyser.connect( audioContext.destination );
  sourceNode.start( 0 );
  isPlaying = true;
  updatePitch();
}

function startLive() {
  stopPlayback();

  getUserMedia(
    {
      "audio": {
        "mandatory": {
          "googEchoCancellation": "false",
          "googAutoGainControl": "false",
          "googNoiseSuppression": "false",
          "googHighpassFilter": "false"
        },
        "optional": []
      },
    }, gotStream);
  isPlaing = true;
}

function startOscillator() {
  console.log("Oscillator");
  stopPlayback();

  sourceNode = audioContext.createOscillator();

  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  sourceNode.connect( analyser );
  analyser.connect( audioContext.destination );
  sourceNode.start(0);
  isPlaying = true;
  updatePitch();
}

var rafID = null;
var tracks = null;
var buflen = 1024;
var buf = new Float32Array( buflen );

var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteFromPitch( frequency ) {
  var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
  return Math.round( noteNum ) + 69;
}

function frequencyFromNoteNumber( note ) {
  return 440 * Math.pow(2,(note-69)/12);
}

function centsOffFromPitch( frequency, note ) {
  return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
}

var MIN_SAMPLES = 0;  // will be initialized when AudioContext is created.

function autoCorrelate( buf, sampleRate ) {
  var SIZE = buf.length;
  var MAX_SAMPLES = Math.floor(SIZE/2);
  var best_offset = -1;
  var best_correlation = 0;
  var rms = 0;
  var foundGoodCorrelation = false;
  var correlations = new Array(MAX_SAMPLES);

  for (var i=0;i<SIZE;i++) {
    var val = buf[i];
    rms += val*val;
  }
  rms = Math.sqrt(rms/SIZE);
  if (rms<0.01) // not enough signal
    return -1;

  var lastCorrelation=1;
  for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
    var correlation = 0;

    for (var i=0; i<MAX_SAMPLES; i++) {
      correlation += Math.abs((buf[i])-(buf[i+offset]));
    }
    correlation = 1 - (correlation/MAX_SAMPLES);
    correlations[offset] = correlation; // store it, for the tweaking we need to do below.
    if ((correlation>0.9) && (correlation > lastCorrelation)) {
      foundGoodCorrelation = true;
      if (correlation > best_correlation) {
        best_correlation = correlation;
        best_offset = offset;
      }
    } else if (foundGoodCorrelation) {
      // short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
      // Now we need to tweak the offset - by interpolating between the values to the left and right of the
      // best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
      // we need to do a curve fit on correlations[] around best_offset in order to better determine precise
      // (anti-aliased) offset.

      // we know best_offset >=1, 
      // since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
      // we can't drop into this clause until the following pass (else if).
      var shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
      return sampleRate/(best_offset+(8*shift));
    }
    lastCorrelation = correlation;
  }
  if (best_correlation > 0.01) {
    return sampleRate/best_offset;
  }
  return -1;
}

function getAvgFrequencyHistory() {

  // Zip the y values with the x values
  var res = [];
  for (var i = 0; i < avgFreqHistory.length; ++i) {
    if (avgFreqHistory[i]) {
      res.push([i, avgFreqHistory[i]])
    } else {
      res.push([i, null])
    }
  }

  return res;
}

function getRawFrequencyHistory() {

  // Zip the y values with the x values
  var res = [];
  for (var i = 0; i < rawFreqHistory.length; ++i) {
    if (rawFreqHistory[i]) {
      res.push([i, rawFreqHistory[i]])
    } else {
      res.push([i, null])
    }
  }

  return res;
}

function calculateAverageFreq() {
  var sum = 0;
  var count = 0;
  for (var i = 0; i < numAvgSamples; ++i) {
    var idx = rawFreqHistory.length - 1 - i;
    if (rawFreqHistory[idx]) {
      sum += rawFreqHistory[idx];
      count += 1;
    }
  }

  var avgPitch;
  if (count) {
    avgPitch = sum / count;
  } else {
    avgPitch = 0;
  }

  avgFreqHistory.shift();
  avgFreqHistory.push(avgPitch);

  return avgPitch;
}

function updatePitch() {
  updateNum += 1;
  var cycles = new Array;
  if (!analyser)
    return;
  analyser.getFloatTimeDomainData( buf );
  var ac = autoCorrelate( buf, audioContext.sampleRate );

  if (DEBUGCANVAS) {  // This draws the current waveform, useful for debugging
    var width = DEBUGCANVAS.width / canvasRatio;
    var height = DEBUGCANVAS.height / canvasRatio;
    var wd4 = width / 4;
    var hd2 = height / 2;
    waveContext.clearRect(0, 0, width, height);
    waveContext.strokeStyle = "red";
    waveContext.beginPath();
    waveContext.moveTo(0, 0);
    waveContext.lineTo(0, height);
    waveContext.moveTo(wd4, 0);
    waveContext.lineTo(wd4, height);
    waveContext.moveTo(2*wd4, 0);
    waveContext.lineTo(2*wd4, height);
    waveContext.moveTo(3*wd4, 0);
    waveContext.lineTo(3*wd4, height);
    waveContext.moveTo(width, 0);
    waveContext.lineTo(width, height);
    waveContext.stroke();
    waveContext.strokeStyle = "black";
    waveContext.beginPath();
    waveContext.moveTo(0, hd2+buf[0]*hd2);
    for (var i=1; i<width; i++) {
      waveContext.lineTo(i, hd2+buf[i]*hd2);
    }
    waveContext.stroke();
  }

  var pitch;
  if (ac == -1) {
    pitch = 0;
  } else {
    pitch = ac;
    if (pitch > maxInputFrequency) {
      pitch = 0;
    } else if (pitch < minInputFrequency) {
      pitch = 0;
    }
  }

  rawFreqHistory.shift();
  rawFreqHistory.push(pitch);

  pitch = calculateAverageFreq();

  if (pitch == 0) {
    detectorElem.className = "vague";
    pitchElem.innerText = "--";
    noteElem.innerText = "-";
    detuneElem.className = "";
    detuneAmount.innerText = "--";
  } else {
    detectorElem.className = "confident";
    pitchElem.innerText = Math.round( pitch ) ;
    var note =  noteFromPitch( pitch );
    noteElem.innerHTML = noteStrings[note%12];
    var detune = centsOffFromPitch( pitch, note );
    if (detune == 0 ) {
      detuneElem.className = "";
      detuneAmount.innerHTML = "--";
    } else {
      if (detune < 0)
        detuneElem.className = "flat";
      else
        detuneElem.className = "sharp";
      detuneAmount.innerHTML = Math.abs( detune );
    }
  }

  if (frequencyPlot && (updateNum % 1) == 0) {
    frequencyPlot.setData([getRawFrequencyHistory(), getAvgFrequencyHistory()]);
    frequencyPlot.draw();
  }

  if (!window.requestAnimationFrame)
    window.requestAnimationFrame = window.webkitRequestAnimationFrame;
  rafID = window.requestAnimationFrame( updatePitch );
}
