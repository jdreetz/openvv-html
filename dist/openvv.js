(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpenVV = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ViewabilityCriteria = require('./Options/ViewabilityCriteria.js');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// import MeasureableElement from './Measurement/MeasureableElement';
// import MeasurementMonitor from './'

// Main entry point
var OpenVV = function () {
  function OpenVV(config) {
    _classCallCheck(this, OpenVV);

    this.config = config;
  }

  _createClass(OpenVV, [{
    key: 'configure',
    value: function configure(config) {
      this.config = config;
    }
  }, {
    key: 'measureElement',
    value: function measureElement(element, strategy) {
      return new Promise(function (res, rej) {});
    }
  }, {
    key: 'beginMeasurement',
    value: function beginMeasurement() {}
  }, {
    key: 'pauseMeasurement',
    value: function pauseMeasurement() {}
  }, {
    key: 'resumeMeasurement',
    value: function resumeMeasurement() {}
  }, {
    key: 'endMeasurement',
    value: function endMeasurement() {}
  }]);

  return OpenVV;
}();

// Expose support classes / constants


exports.default = OpenVV;
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
// OpenVV.MeasureableElement = MeasureableElement;

module.exports = exports['default'];

},{"./Options/ViewabilityCriteria.js":2}],2:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var MRC_VIDEO = exports.MRC_VIDEO = {
  percentViewable: 0.5,
  timeInView: 2000
};

var MRC_DISPLAY = exports.MRC_DISPLAY = {
  percentViewable: 0.5,
  timeInView: 1000
};

var customCriteria = exports.customCriteria = function customCriteria(percentViewable, timeInView) {
  return { percentViewable: percentViewable, timeInView: timeInView };
};

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvT3BlblZWLmpzIiwic3JjL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7O0FDQUE7O0lBQVksbUI7Ozs7OztBQUNaO0FBQ0E7O0FBRUE7SUFDcUIsTTtBQUNuQixrQkFBWSxNQUFaLEVBQW9CO0FBQUE7O0FBQ2xCLFNBQUssTUFBTCxHQUFjLE1BQWQ7QUFDRDs7Ozs4QkFFUyxNLEVBQVE7QUFDaEIsV0FBSyxNQUFMLEdBQWMsTUFBZDtBQUNEOzs7bUNBRWMsTyxFQUFTLFEsRUFBVTtBQUNoQyxhQUFPLElBQUksT0FBSixDQUFZLFVBQUMsR0FBRCxFQUFLLEdBQUwsRUFBYSxDQUFFLENBQTNCLENBQVA7QUFDRDs7O3VDQUVrQixDQUVsQjs7O3VDQUVrQixDQUVsQjs7O3dDQUVtQixDQUVuQjs7O3FDQUVnQixDQUVoQjs7Ozs7O0FBR0g7OztrQkE5QnFCLE07QUErQnJCLE9BQU8sbUJBQVAsR0FBNkIsbUJBQTdCO0FBQ0E7Ozs7Ozs7Ozs7QUNyQ08sSUFBTSxnQ0FBWTtBQUN2QixtQkFBaUIsR0FETTtBQUV2QixjQUFZO0FBRlcsQ0FBbEI7O0FBS0EsSUFBTSxvQ0FBYztBQUN6QixtQkFBaUIsR0FEUTtBQUV6QixjQUFZO0FBRmEsQ0FBcEI7O0FBS0EsSUFBTSwwQ0FBaUIsU0FBakIsY0FBaUIsQ0FBQyxlQUFELEVBQWtCLFVBQWxCO0FBQUEsU0FBa0MsRUFBRSxnQ0FBRixFQUFtQixzQkFBbkIsRUFBbEM7QUFBQSxDQUF2QiIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJpbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4vT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhLmpzJztcbi8vIGltcG9ydCBNZWFzdXJlYWJsZUVsZW1lbnQgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlYWJsZUVsZW1lbnQnO1xuLy8gaW1wb3J0IE1lYXN1cmVtZW50TW9uaXRvciBmcm9tICcuLydcblxuLy8gTWFpbiBlbnRyeSBwb2ludFxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT3BlblZWIHtcbiAgY29uc3RydWN0b3IoY29uZmlnKSB7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIH1cblxuICBjb25maWd1cmUoY29uZmlnKSB7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gIH1cblxuICBtZWFzdXJlRWxlbWVudChlbGVtZW50LCBzdHJhdGVneSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzLHJlaikgPT4ge30pO1xuICB9XG5cbiAgYmVnaW5NZWFzdXJlbWVudCgpIHtcblxuICB9XG5cbiAgcGF1c2VNZWFzdXJlbWVudCgpIHtcblxuICB9XG5cbiAgcmVzdW1lTWVhc3VyZW1lbnQoKSB7XG5cbiAgfVxuXG4gIGVuZE1lYXN1cmVtZW50KCkge1xuXG4gIH1cbn1cblxuLy8gRXhwb3NlIHN1cHBvcnQgY2xhc3NlcyAvIGNvbnN0YW50c1xuT3BlblZWLlZpZXdhYmlsaXR5Q3JpdGVyaWEgPSBWaWV3YWJpbGl0eUNyaXRlcmlhO1xuLy8gT3BlblZWLk1lYXN1cmVhYmxlRWxlbWVudCA9IE1lYXN1cmVhYmxlRWxlbWVudDsiLCJleHBvcnQgY29uc3QgTVJDX1ZJREVPID0ge1xuICBwZXJjZW50Vmlld2FibGU6IDAuNSxcbiAgdGltZUluVmlldzogMjAwMFxufTtcblxuZXhwb3J0IGNvbnN0IE1SQ19ESVNQTEFZID0ge1xuICBwZXJjZW50Vmlld2FibGU6IDAuNSxcbiAgdGltZUluVmlldzogMTAwMFxufTtcblxuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKHBlcmNlbnRWaWV3YWJsZSwgdGltZUluVmlldykgPT4gKHsgcGVyY2VudFZpZXdhYmxlLCB0aW1lSW5WaWV3IH0pOyJdfQ==
