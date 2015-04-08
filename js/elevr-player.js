/**
 * eleVR Web Player: A web viewer for 360 images on the Oculus
 * Copyright (C) 2014 Andrea Hawksley and Andrew Lutomirski
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

"use strict";

var container, canvas, fullScreenButton,
    pictureSelect, projectionSelect,
    leftLoad, rightLoad, panoImage;

var gl, reqAnimFrameID = 0;
var currentScreenOrientation = window.orientation || 0; // active default

var positionsBuffer,
    verticesIndexBuffer,
    lastUpdateTime = 0;

var texture;

var mvMatrix, shader;

var vrHMD, vrSensor;

var manualRotateRate = new Float32Array([0, 0, 0]),  // Vector, camera-relative
    manualRotation = quat.create(),
    manualControls = {
      'a' : {index: 1, sign: 1, active: 0},
      'd' : {index: 1, sign: -1, active: 0},
      'w' : {index: 0, sign: 1, active: 0},
      's' : {index: 0, sign: -1, active: 0},
      'q' : {index: 2, sign: -1, active: 0},
      'e' : {index: 2, sign: 1, active: 0},
    },
    degtorad = Math.PI / 180, // Degree-to-Radian conversion
    prevFrameTime = null,
    showTiming = false,  // Switch to true to show frame times in the console
    framesSinceIssue = 0;

var phoneVR = null;

var ProjectionEnum = Object.freeze({
                  EQUIRECT: 0,
                  EQUIRECT_3D: 1}),
    projection = 0,

    pictureObjectURL = null;

function runEleVRPlayer() {
  initWebVR();

  initElements();
  createControls();

  initWebGL();

  if (gl) {
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clearDepth(1.0);
    gl.disable(gl.DEPTH_TEST);

    setCanvasSize();

    phoneVR = new PhoneVR();

    // Keyboard Controls
    enableKeyControls();

    shader = new ShaderProgram(gl, {
      fragmentShaderName: 'shader-fs',
      vertexShaderName: 'shader-vs',
      attributes: ['aVertexPosition'],
      uniforms: ['uSampler', 'eye', 'projection', 'proj_inv'],
    });

    initBuffers();
    initTextures();

    panoImage.addEventListener("load", loaded);
  }
}

/**
 * Lots of Init Methods
 */
function initWebVR() {
  if (navigator.getVRDevices) {
    navigator.getVRDevices().then(vrDeviceCallback);
  }
}

function initElements() {
  container = document.getElementById("picture-container");
  container.style.width = window.innerWidth + "px";
  container.style.height = window.innerHeight + "px";
  leftLoad = document.getElementById("left-load");
  rightLoad = document.getElementById("right-load");
  canvas = document.getElementById("glcanvas");
  panoImage = document.getElementById("pano-image");

  // Buttons
  fullScreenButton = document.getElementById("full-screen");

  // Selectors
  pictureSelect = document.getElementById("picture-select");
  projectionSelect = document.getElementById("projection-select");

  document.getElementById('title-l').style.fontSize = window.outerHeight / 20 + 'px';
  document.getElementById('title-r').style.fontSize = window.outerHeight / 20 + 'px';
  document.getElementById('message-l').style.fontSize = window.outerHeight / 30 + 'px';
  document.getElementById('message-r').style.fontSize = window.outerHeight / 30 + 'px';
}

function initWebGL() {
  gl = null;

  try {
    gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  } catch(e) {}

  if (!gl) {
    alert("Unable to initialize WebGL. Your browser may not support it.");
  }
}

function initBuffers() {
  positionsBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionsBuffer);
  var positions = [
    -1.0, -1.0,
     1.0, -1.0,
     1.0,  1.0,
    -1.0,  1.0,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  verticesIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, verticesIndexBuffer);
  var vertexIndices = [
    0,  1,  2,      0,  2,  3,
  ]
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(vertexIndices), gl.STATIC_DRAW);
}

function initTextures() {
  texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);
}

function setCanvasSize() {
  var screenWidth, screenHeight;
  screenWidth = window.innerWidth;
  screenHeight = window.innerHeight;

  if (typeof vrHMD !== 'undefined' && typeof util.isFullscreen() !== 'undefined' && util.isFullscreen()) {
    var rectHalf = vrHMD.getEyeParameters('right').renderRect;
    canvas.width = rectHalf.width * 2;
    canvas.height = rectHalf.height;

    canvas.style.width = screenWidth + 'px';
    canvas.style.height = screenHeight + 'px';
  } else {
    // query the various pixel ratios
    var devicePixelRatio = window.devicePixelRatio || 1;
    var backingStoreRatio = gl.webkitBackingStorePixelRatio ||
                            gl.mozBackingStorePixelRatio ||
                            gl.msBackingStorePixelRatio ||
                            gl.oBackingStorePixelRatio ||
                            gl.backingStorePixelRatio || 1;
    var ratio = devicePixelRatio / backingStoreRatio;

    if (canvas.width != screenWidth * ratio || canvas.height != screenHeight * ratio) {
        canvas.width = screenWidth * ratio;
        canvas.height = screenHeight * ratio;

        canvas.style.width = screenWidth + 'px';
        canvas.style.height = screenHeight + 'px';
    }
  }
}

function updateTexture() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB,
      gl.UNSIGNED_BYTE, panoImage);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

function vrDeviceCallback(vrdevs) {
  for (var i = 0; i < vrdevs.length; ++i) {
    if (vrdevs[i] instanceof HMDVRDevice) {
      vrHMD = vrdevs[i];
      break;
    }
  }

  if (!vrHMD)
    return;

  // Then, find that HMD's position sensor
  for (var i = 0; i < vrdevs.length; ++i) {
    if (vrdevs[i] instanceof PositionSensorVRDevice &&
        vrdevs[i].hardwareUnitId == vrHMD.hardwareUnitId)
    {
      vrSensor = vrdevs[i];
      break;
    }
  }

  if (!vrSensor) {
    alert("Found a HMD, but didn't find its orientation sensor?");
  }
}

/**
 * Drawing the scene
 */
function drawOneEye(eye, projectionMatrix) {
  gl.useProgram(shader.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, positionsBuffer);
  gl.vertexAttribPointer(shader.attributes['aVertexPosition'], 2, gl.FLOAT, false, 0, 0);

  // Specify the texture to map onto the faces.
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(shader.uniforms['uSampler'], 0);

  gl.uniform1f(shader.uniforms['eye'], eye);
  gl.uniform1f(shader.uniforms['projection'], projection);

  var rotation = mat4.create();

  if(typeof vrSensor !== 'undefined') {
    var state = vrSensor.getState();
    var totalRotation = quat.create();
    if (state !== null && state.orientation !== null && typeof state.orientation !== 'undefined'
       && state.orientation.x != 0
       && state.orientation.y != 0
       && state.orientation.z != 0
       && state.orientation.w != 0) {
      var sensorOrientation = new Float32Array([state.orientation.x, state.orientation.y, state.orientation.z, state.orientation.w]);
      quat.multiply(totalRotation, manualRotation, sensorOrientation);
    } else {
      totalRotation = manualRotation;
    }
    mat4.fromQuat(rotation, totalRotation);
  } else {
    var totalRotation = quat.create();
    quat.multiply(totalRotation, manualRotation, phoneVR.rotationQuat());
    mat4.fromQuat(rotation, totalRotation);
  }

  var projectionInverse = mat4.create();
  mat4.invert(projectionInverse, projectionMatrix)
  var inv = mat4.create();
  mat4.multiply(inv, rotation, projectionInverse);

  gl.uniformMatrix4fv(shader.uniforms['proj_inv'], false, inv);

  if (eye == 0) { // left eye
    gl.viewport(0, 0, canvas.width/2, canvas.height);
  } else { // right eye
    gl.viewport(canvas.width/2, 0, canvas.width/2, canvas.height);
  }

  // Draw
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, verticesIndexBuffer);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function drawScene(frameTime) {
  if (showTiming)
    var start = performance.now();

  setCanvasSize();

  if (showTiming){
    var canvasResized = performance.now();
  }

  if (showTiming){
    var textureLoaded = performance.now();
  }

  if (prevFrameTime) {
    // Apply manual controls.
    var interval = (frameTime - prevFrameTime) * 0.001;

    var update = quat.fromValues(manualRotateRate[0] * interval,
                                 manualRotateRate[1] * interval,
                                 manualRotateRate[2] * interval, 1.0);
    quat.normalize(update, update);
    quat.multiply(manualRotation, manualRotation, update);
  }

  var perspectiveMatrix = mat4.create();
  if (typeof vrHMD !== 'undefined') {
    var leftParams = vrHMD.getEyeParameters('left');
    var rightParams = vrHMD.getEyeParameters('right');
    perspectiveMatrix = util.mat4PerspectiveFromVRFieldOfView(leftParams.recommendedFieldOfView, 0.1, 10);
    drawOneEye(0, perspectiveMatrix);
    perspectiveMatrix = util.mat4PerspectiveFromVRFieldOfView(rightParams.recommendedFieldOfView, 0.1, 10);
    drawOneEye(1, perspectiveMatrix);
  } else {
    var ratio = (canvas.width/2)/canvas.height;
    mat4.perspective(perspectiveMatrix, Math.PI/2, ratio, .1, 10);
    drawOneEye(0, perspectiveMatrix);
    drawOneEye(1, perspectiveMatrix);
  }


  if (showTiming) {
    gl.finish();
    var end = performance.now();
    if (end - frameTime > 20) {
      console.log(framesSinceIssue + ' Frame time: ' +
    	            (start - frameTime) + 'ms animation frame lag + ' +
                  (canvasResized - start) + 'ms canvas resized + ' +
                  (textureLoaded - canvasResized) + 'ms to load texture + ' +
                  (end - textureLoaded) + 'ms = ' + (end - frameTime) + 'ms');
      framesSinceIssue = 0;
    } else {
      framesSinceIssue++;
    }
  }

  reqAnimFrameID = requestAnimationFrame(drawScene);
  prevFrameTime = frameTime;
}

/**
 * Shader Related Functions
 */
function ShaderProgram(gl, params) {
  this.params = params;
  this.fragmentShader = getShader(gl, this.params.fragmentShaderName);
  this.vertexShader = getShader(gl, this.params.vertexShaderName);

  this.program = gl.createProgram();
  gl.attachShader(this.program, this.vertexShader);
  gl.attachShader(this.program, this.fragmentShader);
  gl.linkProgram(this.program);

  if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
    alert("Unable to initialize the shader program: " + gl.getProgramInfoLog(this.program));
  }

  gl.useProgram(this.program);

  this.attributes = {}
  for (var i = 0; i < this.params.attributes.length; i++) {
    var name = this.params.attributes[i];
    this.attributes[name] = gl.getAttribLocation(this.program, name);
    gl.enableVertexAttribArray(this.attributes[name]);
  }

  this.uniforms = {}
  for (var i = 0; i < this.params.uniforms.length; i++) {
    var name = this.params.uniforms[i];
    this.uniforms[name] = gl.getUniformLocation(this.program, name);
    gl.enableVertexAttribArray(this.attributes[name]);
  }
}

function getShader(gl, id) {
  var shaderScript = document.getElementById(id);

  if (!shaderScript) {
    return null;
  }

  var theSource = "";
  var currentChild = shaderScript.firstChild;

  while(currentChild) {
    if (currentChild.nodeType == 3) {
      theSource += currentChild.textContent;
    }

    currentChild = currentChild.nextSibling;
  }

  var shader;

  if (shaderScript.type == "x-shader/x-fragment") {
    shader = gl.createShader(gl.FRAGMENT_SHADER);
  } else if (shaderScript.type == "x-shader/x-vertex") {
    shader = gl.createShader(gl.VERTEX_SHADER);
  } else {
    return null;  // Unknown shader type
  }

  gl.shaderSource(shader, theSource);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader));
    return null;
  }

  return shader;
}

/**
 * Commands
 */
function loaded() {
  leftLoad.style.display = "none";
  rightLoad.style.display = "none";

  updateTexture();
  reqAnimFrameID = requestAnimationFrame(drawScene);
}

function selectLocalPicture() {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";

  input.addEventListener("change", function (event) {
    var files = input.files;
    if (!files.length) {
      // The user didn't select anything.  Sad.
      console.log('File selection canceled');
      return;
    }

    pictureObjectURL = URL.createObjectURL(files[0]);
    console.log('Loading local file ', files[0].name, ' at URL ', pictureObjectURL);
    pictureSelect.value = "";
    loadImage(pictureObjectURL);
  });

  input.click();
}

function loadImage(imageFile) {
  leftLoad.style.display = "block";
  rightLoad.style.display = "block";

  gl.clear(gl.COLOR_BUFFER_BIT);

  if (reqAnimFrameID) {
    cancelAnimationFrame(reqAnimFrameID);
    reqAnimFrameID = 0;
  }

  var oldObjURL = pictureObjectURL;
  pictureObjectURL = null;

  panoImage.src = imageFile;

  if (pictureObjectURL && pictureObjectURL != imageFile) {
    URL.removeObjectURL(oldObjURL);
  }
}

function fullscreen() {
  if (canvas.mozRequestFullScreen) {
    canvas.mozRequestFullScreen({ vrDisplay: vrHMD }); // Firefox
  } else if (canvas.webkitRequestFullscreen) {
    canvas.webkitRequestFullscreen({ vrDisplay: vrHMD }); // Chrome and Safari
  } else if (canvas.requestFullScreen){
    canvas.requestFullscreen();
  }
}

function fullscreenIgnoreHMD() {
  if (canvas.mozRequestFullScreen) {
    canvas.mozRequestFullScreen(); // Firefox
  } else if (canvas.webkitRequestFullscreen) {
    canvas.webkitRequestFullscreen(); // Chrome and Safari
  } else if (canvas.requestFullScreen){
    canvas.requestFullscreen();
  }
}

/**
 * Controls
 */
function createControls() {
  fullScreenButton.addEventListener("click", function() {
    fullscreen();
  });

  pictureSelect.addEventListener("change", function() {
    projection = pictureSelect.value[0];
    projectionSelect.value = projection;
    loadImage(pictureSelect.value.substring(1));
  });


  projectionSelect.addEventListener("change", function() {
    projection = projectionSelect.value;
  });

  document.getElementById("select-local-file").addEventListener("click", function(event) {
    event.preventDefault();
    selectLocalPicture();
  });
}

/**
 * Keyboard Controls
 */
function enableKeyControls() {
  function key(event, sign) {
    var control = manualControls[String.fromCharCode(event.keyCode).toLowerCase()];
    if (!control)
      return;
    if (sign == 1 && control.active || sign == -1 && !control.active)
      return;
    control.active = (sign == 1);
    manualRotateRate[control.index] += sign * control.sign;
  }

  function onkey(event) {
    switch (String.fromCharCode(event.charCode)) {
    case 'f':
      fullscreen();
      break;
    case 'z':
      vrSensor.zeroSensor();
      break;
    case 'g':
      fullscreenIgnoreHMD();
      break;
    }
  }

  document.addEventListener('keydown', function(event) { key(event, 1); },
          false);
  document.addEventListener('keyup', function(event) { key(event, -1); },
          false);
  window.addEventListener("keypress", onkey, true);
}
