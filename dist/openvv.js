(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpenVV = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var AbstractMeasureable = function () {
  function AbstractMeasureable() {
    _classCallCheck(this, AbstractMeasureable);

    this.listeners = {
      inView: [],
      outView: []
    };

    this.percentViewable = 0.0;
  }

  // element is in view according to strategy defined by concrete measurement class


  _createClass(AbstractMeasureable, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }

    // element no longer in view

  }, {
    key: 'onOutView',
    value: function onOutView(cb) {
      return this.addCallback(cb, 'outView');
    }
  }, {
    key: 'addCallback',
    value: function addCallback(callback, event) {
      if (typeof callback === 'function' && this.listeners[event]) {
        this.listeners[event].push(callback);
      }

      return this;
    }
  }, {
    key: 'canMeasure',
    value: function canMeasure() {
      return false;
    }
  }, {
    key: 'start',
    value: function start() {}
  }, {
    key: 'stop',
    value: function stop() {}
  }, {
    key: 'destroy',
    value: function destroy() {}
  }]);

  return AbstractMeasureable;
}();

exports.default = AbstractMeasureable;
module.exports = exports['default'];

},{}],2:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _AbstractMeasureable2 = require('./AbstractMeasureable');

var _AbstractMeasureable3 = _interopRequireDefault(_AbstractMeasureable2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var IOPolyFillMeasureable = function (_AbstractMeasureable) {
  _inherits(IOPolyFillMeasureable, _AbstractMeasureable);

  function IOPolyFillMeasureable() {
    _classCallCheck(this, IOPolyFillMeasureable);

    return _possibleConstructorReturn(this, (IOPolyFillMeasureable.__proto__ || Object.getPrototypeOf(IOPolyFillMeasureable)).apply(this, arguments));
  }

  return IOPolyFillMeasureable;
}(_AbstractMeasureable3.default);

exports.default = IOPolyFillMeasureable;
module.exports = exports['default'];

},{"./AbstractMeasureable":1}],3:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _AbstractMeasureable2 = require('./AbstractMeasureable');

var _AbstractMeasureable3 = _interopRequireDefault(_AbstractMeasureable2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var IntersectionObserverMeasureable = function (_AbstractMeasureable) {
  _inherits(IntersectionObserverMeasureable, _AbstractMeasureable);

  function IntersectionObserverMeasureable(element, criteria) {
    _classCallCheck(this, IntersectionObserverMeasureable);

    var _this = _possibleConstructorReturn(this, (IntersectionObserverMeasureable.__proto__ || Object.getPrototypeOf(IntersectionObserverMeasureable)).call(this));

    if (criteria !== undefined && element && _this.canMeasure()) {
      _this.element = element;
      _this.criteria = criteria;
      _this.observer = new IntersectionObserver(_this.viewableChange.bind(_this), { threshold: criteria.inViewThreshold });
    }
    return _this;
  }

  _createClass(IntersectionObserverMeasureable, [{
    key: 'start',
    value: function start() {
      this.observer.observe(this.element);
    }
  }, {
    key: 'canMeasure',
    value: function canMeasure() {
      return !!window.IntersectionObserver;
    }
  }, {
    key: 'viewableChange',
    value: function viewableChange(entries) {
      var _this2 = this;

      if (entries && entries.length && entries[0].intersectionRatio !== undefined) {
        this.percentViewable = entries[0].intersectionRatio;

        if (entries[0].intersectionRatio === 0.0) {
          this.listeners.outView.forEach(function (l) {
            return l(_this2.percentViewable);
          });
        }
        if (entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
          this.listeners.inView.forEach(function (l) {
            return l(_this2.percentViewable);
          });
        }
      }
    }
  }]);

  return IntersectionObserverMeasureable;
}(_AbstractMeasureable3.default);

exports.default = IntersectionObserverMeasureable;
module.exports = exports['default'];

},{"./AbstractMeasureable":1}],4:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _IntersectionObserverMeasureable = require('./IntersectionObserverMeasureable');

Object.defineProperty(exports, 'IntersectionObserverMeasureable', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IntersectionObserverMeasureable).default;
  }
});

var _IOPolyFillMeasureable = require('./IOPolyFillMeasureable');

Object.defineProperty(exports, 'IOPolyFillMeasureable', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IOPolyFillMeasureable).default;
  }
});

var _AbstractMeasureable = require('./AbstractMeasureable');

Object.defineProperty(exports, 'AbstractMeasureable', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_AbstractMeasureable).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./AbstractMeasureable":1,"./IOPolyFillMeasureable":2,"./IntersectionObserverMeasureable":3}],5:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _InViewTimer = require('../Timing/InViewTimer');

var _InViewTimer2 = _interopRequireDefault(_InViewTimer);

var _Strategies = require('./Strategies/');

var _rules = require('./Strategies/rules');

var Rules = _interopRequireWildcard(_rules);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// Responsible for collecting measurement strategy,
// watching for measurement changes,
// tracking how long an element is viewable for,
// and notifying listeners of changes
var MeasurementExecutor = function () {
  function MeasurementExecutor(element) {
    var _this = this;

    var strategy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : (0, _Strategies.defaultStrategy)();

    _classCallCheck(this, MeasurementExecutor);

    this.timers = {};
    this.listeners = { start: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = strategy;
    this.measureables = strategy.measureables.map(this.instantiateMeasureable.bind(this));
    if (this.unMeasureable()) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout(function () {
        return _this.listeners.unmeasureable.forEach(function (m) {
          return m();
        });
      }, 0);
    }
  }

  _createClass(MeasurementExecutor, [{
    key: 'instantiateMeasureable',
    value: function instantiateMeasureable(Measureable) {
      if (typeof Measureable === 'function') {
        var instance = new Measureable(element, this.strategy.criteria);

        instance.id = new Date().getTime();
        instance.onInView(this.measureableChange.bind(this, 'inview', instance));
        instance.onOutView(this.measureableChange.bind(this, 'outview', instance));

        if (this.strategy.autostart) {
          instance.start();
        }

        return instance;
      }
    }
  }, {
    key: 'measureableChange',
    value: function measureableChange(change, measureable) {
      var timer = this.timers[measureable.id];

      switch (change) {
        case 'inview':
          if (!timer) {
            timer = new _InViewTimer2.default(this.strategy.criteria.timeInView);
            timer.elapsed(this.timerElapsed.bind(this, measureable));
            this.timers[measureable.id] = timer;
          }
          timer.start();
          this.listeners.start.forEach(function (l) {
            return l(measureable);
          });
          break;
        case 'outview':
          if (timer) {
            timer.pause();
          }
          break;
      }
    }
  }, {
    key: 'timerElapsed',
    value: function timerElapsed(measureable) {
      if (this.strategy.rule === Rules.ANY || this.strategy.rule === Rules.ALL && this.allCompleted()) {
        this.listeners.complete.forEach(function (l) {
          return l(measureable);
        });
      }
    }
  }, {
    key: 'addCallback',
    value: function addCallback(callback, event) {
      if (this.listeners[event] && typeof callback === 'function') {
        this.listeners[event].push(callback);
      }

      return this;
    }
  }, {
    key: 'allCompleted',
    value: function allCompleted() {
      return this.completedTimers() === this.measureables.length;
    }
  }, {
    key: 'completedTimers',
    value: function completedTimers() {
      return this.timers.reduce(function (count, timer) {
        return timer.completed ? count + 1 : count;
      }, 0);
    }
  }, {
    key: 'unMeasureableCount',
    value: function unMeasureableCount() {
      return this.measureables.reduce(function (count, m) {
        return m.unmeasureable ? count + 1 : count;
      }, 0);
    }
  }, {
    key: 'unMeasureable',
    value: function unMeasureable() {
      if (this.strategy.rule === Rules.ANY && this.unMeasureableCount() > 0) {
        return true;
      } else if (this.strategy.rule === Rules.ALL && this.unMeasureableCount() === this.measureables.length) {
        return true;
      }

      return false;
    }
  }, {
    key: 'start',
    value: function start() {
      this.measureables.forEach(function (m) {
        return m.start && m.start();
      });
    }

    // Main event dispatchers

  }, {
    key: 'onViewableStart',
    value: function onViewableStart(callback) {
      return this.addCallback(callback, 'start');
    }
  }, {
    key: 'onViewableComplete',
    value: function onViewableComplete(callback) {
      return this.addCallback(callback, 'complete');
    }
  }, {
    key: 'onUnMeasureable',
    value: function onUnMeasureable(callback) {
      return this.addCallback(callback, 'unmeasureable');
    }
  }]);

  return MeasurementExecutor;
}();

exports.default = MeasurementExecutor;
module.exports = exports['default'];

},{"../Timing/InViewTimer":10,"./Strategies/":6,"./Strategies/rules":7}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.defaultStrategy = undefined;

var _Measureables = require('../Measureables/');

var Measureables = _interopRequireWildcard(_Measureables);

var _ViewabilityCriteria = require('../../Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

var _rules = require('./rules');

var Rules = _interopRequireWildcard(_rules);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

var defaultStrategy = exports.defaultStrategy = function defaultStrategy() {
  return {
    autostart: true,
    rule: Rules.ANY,
    measureables: [Measureables.IntersectionObserverMeasureable, Measureables.IOPolyFillMeasureable],
    criteria: ViewabilityCriteria.MRC_VIDEO
  };
};

},{"../../Options/ViewabilityCriteria":9,"../Measureables/":4,"./rules":7}],7:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var ALL = exports.ALL = 'all';
var ANY = exports.ANY = 'any';

},{}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();
// import MeasurementController from 'Measurement/MeasurementController';


var _ViewabilityCriteria = require('./Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

var _MeasurementExecutor = require('./Measurement/MeasurementExecutor');

var _MeasurementExecutor2 = _interopRequireDefault(_MeasurementExecutor);

var _Strategies = require('./Measurement/Strategies/');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// import MeasureableElement from './Measurement/MeasureableElement';
// import MeasurementMonitor from './'

// Main entry point
var OpenVV = function () {
  function OpenVV(userDefaults) {
    _classCallCheck(this, OpenVV);

    // if(config !== undefined) {
    //   this.config = config;
    //   this.initController(config);
    // }
    this.executors = [];
    // this.globalStrategy = Object.assign(defaultStrategy(),userDefaults);
  }

  _createClass(OpenVV, [{
    key: 'configure',
    value: function configure(config) {
      this.config = config;
      // initController(config);
    }
  }, {
    key: 'measureElement',
    value: function measureElement(element, strategy) {
      var executor = new _MeasurementExecutor2.default(element, strategy);
      this.executors.push(executor);
      return executor;
    }
  }]);

  return OpenVV;
}();

// Expose support classes / constants


exports.default = OpenVV;
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
// OpenVV.MeasureableElement = MeasureableElement;

module.exports = exports['default'];

},{"./Measurement/MeasurementExecutor":5,"./Measurement/Strategies/":6,"./Options/ViewabilityCriteria":9}],9:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var MRC_VIDEO = exports.MRC_VIDEO = {
  inViewThreshold: 0.5,
  timeInView: 2000
};

var MRC_DISPLAY = exports.MRC_DISPLAY = {
  inViewThreshold: 0.5,
  timeInView: 1000
};

var customCriteria = exports.customCriteria = function customCriteria(inViewThreshold, timeInView) {
  return { inViewThreshold: inViewThreshold, timeInView: timeInView };
};

},{}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var InViewTimer = function () {
  function InViewTimer(duration) {
    _classCallCheck(this, InViewTimer);

    this.duration = duration;
    this.listeners = [];
    this.completed = false;
  }

  _createClass(InViewTimer, [{
    key: 'timerComplete',
    value: function timerComplete() {
      this.completed = true;
      this.listeners.forEach(function (l) {
        return l();
      });
    }
  }, {
    key: 'elapsed',
    value: function elapsed(cb) {
      if (typeof cb === 'function') {
        this.listeners.push(cb);
      }
    }
  }, {
    key: 'start',
    value: function start() {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(this.timerComplete.bind(this), this.duration);
    }
  }, {
    key: 'pause',
    value: function pause() {
      clearTimeout(this.timer);
    }
  }, {
    key: 'resume',
    value: function resume() {
      this.timer = setTimeout(this.timerComplete.bind(this), this.duration);
    }
  }]);

  return InViewTimer;
}();

exports.default = InViewTimer;
module.exports = exports['default'];

},{}]},{},[8])(8)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZWFibGVzL0Fic3RyYWN0TWVhc3VyZWFibGUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZWFibGVzL0lPUG9seUZpbGxNZWFzdXJlYWJsZS5qcyIsInNyYy9NZWFzdXJlbWVudC9NZWFzdXJlYWJsZXMvSW50ZXJzZWN0aW9uT2JzZXJ2ZXJNZWFzdXJlYWJsZS5qcyIsInNyYy9NZWFzdXJlbWVudC9NZWFzdXJlYWJsZXMvaW5kZXguanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRFeGVjdXRvci5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL01lYXN1cmVtZW50L1N0cmF0ZWdpZXMvcnVsZXMuanMiLCJzcmMvT3BlblZWLmpzIiwic3JjL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYS5qcyIsInNyYy9UaW1pbmcvSW5WaWV3VGltZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7O0lDQXFCLG1CO0FBQ25CLGlDQUFjO0FBQUE7O0FBQ1osU0FBSyxTQUFMLEdBQWlCO0FBQ2YsY0FBTyxFQURRO0FBRWYsZUFBUTtBQUZPLEtBQWpCOztBQUtBLFNBQUssZUFBTCxHQUF1QixHQUF2QjtBQUNEOztBQUVEOzs7Ozs2QkFDUyxFLEVBQUk7QUFDWCxhQUFPLEtBQUssV0FBTCxDQUFpQixFQUFqQixFQUFvQixRQUFwQixDQUFQO0FBQ0Q7O0FBRUQ7Ozs7OEJBQ1UsRSxFQUFJO0FBQ1osYUFBTyxLQUFLLFdBQUwsQ0FBaUIsRUFBakIsRUFBb0IsU0FBcEIsQ0FBUDtBQUNEOzs7Z0NBRVcsUSxFQUFVLEssRUFBTztBQUMzQixVQUFHLE9BQU8sUUFBUCxLQUFvQixVQUFwQixJQUFrQyxLQUFLLFNBQUwsQ0FBZSxLQUFmLENBQXJDLEVBQTREO0FBQzFELGFBQUssU0FBTCxDQUFl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SUFBbkIsQ0FBd0IsSUFBeEIsQ0FBWCxFQUF5QyxLQUFLLFFBQTlDLENBQWI7QUFDRDs7Ozs7O2tCQS9Ca0IsVyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJleHBvcnQgZGVmYXVsdCBjbGFzcyBBYnN0cmFjdE1lYXN1cmVhYmxlIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7XG4gICAgICBpblZpZXc6W10sXG4gICAgICBvdXRWaWV3OltdXG4gICAgfTtcblxuICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gMC4wO1xuICB9XG5cbiAgLy8gZWxlbWVudCBpcyBpbiB2aWV3IGFjY29yZGluZyB0byBzdHJhdGVneSBkZWZpbmVkIGJ5IGNvbmNyZXRlIG1lYXN1cmVtZW50IGNsYXNzXG4gIG9uSW5WaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2luVmlldycpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBubyBsb25nZXIgaW4gdmlld1xuICBvbk91dFZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnb3V0VmlldycpO1xuICB9XG5cbiAgYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nICYmIHRoaXMubGlzdGVuZXJzW2V2ZW50XSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgY2FuTWVhc3VyZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBzdGFydCgpIHt9XG4gIHN0b3AoKSB7fVxuICBkZXN0cm95KCkge31cbn0iLCJpbXBvcnQgQWJzdHJhY3RNZWFzdXJlYWJsZSBmcm9tICcuL0Fic3RyYWN0TWVhc3VyZWFibGUnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJT1BvbHlGaWxsTWVhc3VyZWFibGUgZXh0ZW5kcyBBYnN0cmFjdE1lYXN1cmVhYmxlIHtcbiAgLy8gY29uc3RydWN0b3IoZWxlbWVudCwgY3JpdGVyaWEpIHtcbiAgLy8gICBzdXBlcigpO1xuICAvLyAgIGlmKHBlcmNlbnRWaWV3YWJsZSAhPT0gdW5kZWZpbmVkICYmIGVsZW1lbnQgJiYgdGhpcy5jYW5NZWFzdXJlKCkpIHtcbiAgLy8gICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gIC8vICAgICB0aGlzLmNyaXRlcmlhID0gY3JpdGVyaWE7XG4gIC8vICAgICB0aGlzLm9ic2VydmVyID0gbmV3IEludGVyc2VjdGlvbk9ic2VydmVyKHRoaXMudmlld2FibGVDaGFuZ2UuYmluZCh0aGlzKSx7IHRocmVzaG9sZDogY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkIH0pO1xuICAvLyAgIH0gXG4gIC8vIH1cblxuICAvLyBjYW5NZWFzdXJlKCkge1xuICAvLyAgIHJldHVybiAhIXdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlcjtcbiAgLy8gfVxuXG4gIC8vIHZpZXdhYmxlQ2hhbmdlKG9ic2VydmVyRW50cmllcykge1xuICAvLyAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gIC8vICAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW87XG4gICAgICBcbiAgLy8gICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPT09IDAuMCkge1xuICAvLyAgICAgICB0aGlzLmxpc3RlbmVycy5vdXRWaWV3LmZvckVhY2goIGwgPT4gbCh0aGlzLnBlcmNlbnRWaWV3YWJsZSkgKTtcbiAgLy8gICAgIH1cbiAgLy8gICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPT09IHRoaXMuY3JpdGVyaWEucGVyY2VudFZpZXdhYmxlKSB7XG4gIC8vICAgICAgIHRoaXMubGlzdGVuZXJzLmluVmlldy5mb3JFYWNoKCBsID0+IGwodGhpcy5wZXJjZW50Vmlld2FibGUpICk7XG4gIC8vICAgICB9XG4gIC8vICAgfVxuICAvLyB9XG59IiwiaW1wb3J0IEFic3RyYWN0TWVhc3VyZWFibGUgZnJvbSAnLi9BYnN0cmFjdE1lYXN1cmVhYmxlJztcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJNZWFzdXJlYWJsZSBleHRlbmRzIEFic3RyYWN0TWVhc3VyZWFibGUge1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBjcml0ZXJpYSkge1xuICAgIHN1cGVyKCk7XG4gICAgaWYoY3JpdGVyaWEgIT09IHVuZGVmaW5lZCAmJiBlbGVtZW50ICYmIHRoaXMuY2FuTWVhc3VyZSgpKSB7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50O1xuICAgICAgdGhpcy5jcml0ZXJpYSA9IGNyaXRlcmlhO1xuICAgICAgdGhpcy5vYnNlcnZlciA9IG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlcih0aGlzLnZpZXdhYmxlQ2hhbmdlLmJpbmQodGhpcykseyB0aHJlc2hvbGQ6IGNyaXRlcmlhLmluVmlld1RocmVzaG9sZCB9KTtcbiAgICB9IFxuICB9XG5cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5vYnNlcnZlci5vYnNlcnZlKHRoaXMuZWxlbWVudCk7XG4gIH1cblxuICBjYW5NZWFzdXJlKCkge1xuICAgIHJldHVybiAhIXdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlcjtcbiAgfVxuXG4gIHZpZXdhYmxlQ2hhbmdlKGVudHJpZXMpIHtcbiAgICBpZihlbnRyaWVzICYmIGVudHJpZXMubGVuZ3RoICYmIGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5wZXJjZW50Vmlld2FibGUgPSBlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvO1xuICAgICAgXG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID09PSAwLjApIHtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMub3V0Vmlldy5mb3JFYWNoKCBsID0+IGwodGhpcy5wZXJjZW50Vmlld2FibGUpICk7XG4gICAgICB9XG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID49IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmluVmlldy5mb3JFYWNoKCBsID0+IGwodGhpcy5wZXJjZW50Vmlld2FibGUpICk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbn0iLCJleHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyTWVhc3VyZWFibGUgfSBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyTWVhc3VyZWFibGUnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBJT1BvbHlGaWxsTWVhc3VyZWFibGUgfSBmcm9tICcuL0lPUG9seUZpbGxNZWFzdXJlYWJsZSc7XG5leHBvcnQgeyBkZWZhdWx0IGFzIEFic3RyYWN0TWVhc3VyZWFibGUgfSBmcm9tICcuL0Fic3RyYWN0TWVhc3VyZWFibGUnOyIsImltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0IHsgZGVmYXVsdFN0cmF0ZWd5IH0gZnJvbSAnLi9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgKiBhcyBSdWxlcyBmcm9tICcuL1N0cmF0ZWdpZXMvcnVsZXMnO1xuXG4vLyBSZXNwb25zaWJsZSBmb3IgY29sbGVjdGluZyBtZWFzdXJlbWVudCBzdHJhdGVneSxcbi8vIHdhdGNoaW5nIGZvciBtZWFzdXJlbWVudCBjaGFuZ2VzLFxuLy8gdHJhY2tpbmcgaG93IGxvbmcgYW4gZWxlbWVudCBpcyB2aWV3YWJsZSBmb3IsXG4vLyBhbmQgbm90aWZ5aW5nIGxpc3RlbmVycyBvZiBjaGFuZ2VzXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZWFzdXJlbWVudEV4ZWN1dG9yIHtcbiAgY29uc3RydWN0b3IoZWxlbWVudCwgc3RyYXRlZ3kgPSBkZWZhdWx0U3RyYXRlZ3koKSkge1xuICAgIHRoaXMudGltZXJzID0ge307XG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7IHN0YXJ0OiBbXSwgY29tcGxldGU6IFtdLCB1bm1lYXN1cmVhYmxlOiBbXSB9O1xuICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgdGhpcy5zdHJhdGVneSA9IHN0cmF0ZWd5O1xuICAgIHRoaXMubWVhc3VyZWFibGVzID0gc3RyYXRlZ3kubWVhc3VyZWFibGVzLm1hcCh0aGlzLmluc3RhbnRpYXRlTWVhc3VyZWFibGUuYmluZCh0aGlzKSk7XG4gICAgaWYodGhpcy51bk1lYXN1cmVhYmxlKCkpIHtcbiAgICAgIC8vIGZpcmUgdW5tZWFzdXJlYWJsZSBhZnRlciBjdXJyZW50IEpTIGxvb3AgY29tcGxldGVzIFxuICAgICAgLy8gc28gb3Bwb3J0dW5pdHkgaXMgZ2l2ZW4gZm9yIGNvbnN1bWVycyB0byBwcm92aWRlIHVubWVhc3VyZWFibGUgY2FsbGJhY2tcbiAgICAgIHNldFRpbWVvdXQoICgpID0+IHRoaXMubGlzdGVuZXJzLnVubWVhc3VyZWFibGUuZm9yRWFjaCggbSA9PiBtKCkgKSwgMCk7XG4gICAgfVxuICB9XG5cbiAgaW5zdGFudGlhdGVNZWFzdXJlYWJsZShNZWFzdXJlYWJsZSkge1xuICAgIGlmKHR5cGVvZiBNZWFzdXJlYWJsZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY29uc3QgaW5zdGFuY2UgPSBuZXcgTWVhc3VyZWFibGUoZWxlbWVudCx0aGlzLnN0cmF0ZWd5LmNyaXRlcmlhKTtcbiAgICAgIFxuICAgICAgaW5zdGFuY2UuaWQgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICAgIGluc3RhbmNlLm9uSW5WaWV3KHRoaXMubWVhc3VyZWFibGVDaGFuZ2UuYmluZCh0aGlzLCdpbnZpZXcnLGluc3RhbmNlKSk7XG4gICAgICBpbnN0YW5jZS5vbk91dFZpZXcodGhpcy5tZWFzdXJlYWJsZUNoYW5nZS5iaW5kKHRoaXMsJ291dHZpZXcnLGluc3RhbmNlKSk7XG4gICAgICBcbiAgICAgIGlmKHRoaXMuc3RyYXRlZ3kuYXV0b3N0YXJ0KSB7XG4gICAgICAgIGluc3RhbmNlLnN0YXJ0KCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBpbnN0YW5jZTtcbiAgICB9XG4gIH1cblxuICBtZWFzdXJlYWJsZUNoYW5nZShjaGFuZ2UsIG1lYXN1cmVhYmxlKSB7XG4gICAgbGV0IHRpbWVyID0gdGhpcy50aW1lcnNbbWVhc3VyZWFibGUuaWRdO1xuXG4gICAgc3dpdGNoKGNoYW5nZSkge1xuICAgICAgY2FzZSAnaW52aWV3JzpcbiAgICAgICAgaWYoIXRpbWVyKSB7XG4gICAgICAgICAgdGltZXIgPSBuZXcgSW5WaWV3VGltZXIodGhpcy5zdHJhdGVneS5jcml0ZXJpYS50aW1lSW5WaWV3KTtcbiAgICAgICAgICB0aW1lci5lbGFwc2VkKHRoaXMudGltZXJFbGFwc2VkLmJpbmQodGhpcyxtZWFzdXJlYWJsZSkpO1xuICAgICAgICAgIHRoaXMudGltZXJzW21lYXN1cmVhYmxlLmlkXSA9IHRpbWVyO1xuICAgICAgICB9XG4gICAgICAgIHRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLnN0YXJ0LmZvckVhY2goIGwgPT4gbChtZWFzdXJlYWJsZSkgKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdvdXR2aWV3JzpcbiAgICAgICAgaWYodGltZXIpIHtcbiAgICAgICAgICB0aW1lci5wYXVzZSgpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuXG4gIHRpbWVyRWxhcHNlZChtZWFzdXJlYWJsZSkge1xuICAgIGlmKHRoaXMuc3RyYXRlZ3kucnVsZSA9PT0gUnVsZXMuQU5ZIHx8ICh0aGlzLnN0cmF0ZWd5LnJ1bGUgPT09IFJ1bGVzLkFMTCAmJiB0aGlzLmFsbENvbXBsZXRlZCgpKSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnMuY29tcGxldGUuZm9yRWFjaCggbCA9PiBsKG1lYXN1cmVhYmxlKSApO1xuICAgIH1cbiAgfVxuXG4gIGFkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHRoaXMubGlzdGVuZXJzW2V2ZW50XSAmJiB0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGFsbENvbXBsZXRlZCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb21wbGV0ZWRUaW1lcnMoKSA9PT0gdGhpcy5tZWFzdXJlYWJsZXMubGVuZ3RoO1xuICB9XG5cbiAgY29tcGxldGVkVGltZXJzKCkge1xuICAgIHJldHVybiB0aGlzLnRpbWVycy5yZWR1Y2UoIChjb3VudCx0aW1lcikgPT4gdGltZXIuY29tcGxldGVkID8gY291bnQgKyAxIDogY291bnQsIDApO1xuICB9XG5cbiAgdW5NZWFzdXJlYWJsZUNvdW50KCkge1xuICAgIHJldHVybiB0aGlzLm1lYXN1cmVhYmxlcy5yZWR1Y2UoIChjb3VudCxtKSA9PiBtLnVubWVhc3VyZWFibGUgPyBjb3VudCArIDEgOiBjb3VudCwgMCk7XG4gIH1cblxuICB1bk1lYXN1cmVhYmxlKCkge1xuICAgIGlmKHRoaXMuc3RyYXRlZ3kucnVsZSA9PT0gUnVsZXMuQU5ZICYmIHRoaXMudW5NZWFzdXJlYWJsZUNvdW50KCkgPiAwKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgZWxzZSBpZih0aGlzLnN0cmF0ZWd5LnJ1bGUgPT09IFJ1bGVzLkFMTCAmJiB0aGlzLnVuTWVhc3VyZWFibGVDb3VudCgpID09PSB0aGlzLm1lYXN1cmVhYmxlcy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMubWVhc3VyZWFibGVzLmZvckVhY2goIG0gPT4gbS5zdGFydCAmJiBtLnN0YXJ0KCkgKTtcbiAgfVxuXG4gIC8vIE1haW4gZXZlbnQgZGlzcGF0Y2hlcnNcbiAgb25WaWV3YWJsZVN0YXJ0KGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2FsbGJhY2ssJ3N0YXJ0Jyk7XG4gIH1cblxuICBvblZpZXdhYmxlQ29tcGxldGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYWxsYmFjaywnY29tcGxldGUnKTtcbiAgfVxuXG4gIG9uVW5NZWFzdXJlYWJsZShjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNhbGxiYWNrLCd1bm1lYXN1cmVhYmxlJyk7XG4gIH1cbn0iLCJpbXBvcnQgKiBhcyBNZWFzdXJlYWJsZXMgZnJvbSAnLi4vTWVhc3VyZWFibGVzLyc7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5pbXBvcnQgKiBhcyBSdWxlcyBmcm9tICcuL3J1bGVzJztcblxuZXhwb3J0IGNvbnN0IGRlZmF1bHRTdHJhdGVneSA9ICgpID0+ICh7XG4gIGF1dG9zdGFydDogdHJ1ZSxcbiAgcnVsZTogUnVsZXMuQU5ZLFxuICBtZWFzdXJlYWJsZXM6IFtNZWFzdXJlYWJsZXMuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJNZWFzdXJlYWJsZSwgTWVhc3VyZWFibGVzLklPUG9seUZpbGxNZWFzdXJlYWJsZV0sXG4gIGNyaXRlcmlhOiBWaWV3YWJpbGl0eUNyaXRlcmlhLk1SQ19WSURFT1xufSk7IiwiZXhwb3J0IGNvbnN0IEFMTCA9ICdhbGwnO1xuZXhwb3J0IGNvbnN0IEFOWSA9ICdhbnknOyIsImltcG9ydCAqIGFzIFZpZXdhYmlsaXR5Q3JpdGVyaWEgZnJvbSAnLi9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEnO1xuLy8gaW1wb3J0IE1lYXN1cmVtZW50Q29udHJvbGxlciBmcm9tICdNZWFzdXJlbWVudC9NZWFzdXJlbWVudENvbnRyb2xsZXInO1xuaW1wb3J0IE1lYXN1cmVtZW50RXhlY3V0b3IgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudEV4ZWN1dG9yJztcbmltcG9ydCB7IGRlZmF1bHRTdHJhdGVneSB9IGZyb20gJy4vTWVhc3VyZW1lbnQvU3RyYXRlZ2llcy8nO1xuLy8gaW1wb3J0IE1lYXN1cmVhYmxlRWxlbWVudCBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVhYmxlRWxlbWVudCc7XG4vLyBpbXBvcnQgTWVhc3VyZW1lbnRNb25pdG9yIGZyb20gJy4vJ1xuXG4vLyBNYWluIGVudHJ5IHBvaW50XG5leHBvcnQgZGVmYXVsdCBjbGFzcyBPcGVuVlYge1xuICBjb25zdHJ1Y3Rvcih1c2VyRGVmYXVsdHMpIHtcbiAgICAvLyBpZihjb25maWcgIT09IHVuZGVmaW5lZCkge1xuICAgIC8vICAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gICAgLy8gICB0aGlzLmluaXRDb250cm9sbGVyKGNvbmZpZyk7XG4gICAgLy8gfVxuICAgIHRoaXMuZXhlY3V0b3JzID0gW107XG4gICAgLy8gdGhpcy5nbG9iYWxTdHJhdGVneSA9IE9iamVjdC5hc3NpZ24oZGVmYXVsdFN0cmF0ZWd5KCksdXNlckRlZmF1bHRzKTtcbiAgfVxuXG4gIGNvbmZpZ3VyZShjb25maWcpIHtcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICAvLyBpbml0Q29udHJvbGxlcihjb25maWcpO1xuICB9XG5cbiAgbWVhc3VyZUVsZW1lbnQoZWxlbWVudCwgc3RyYXRlZ3kpIHtcbiAgICBjb25zdCBleGVjdXRvciA9IG5ldyBNZWFzdXJlbWVudEV4ZWN1dG9yKGVsZW1lbnQsc3RyYXRlZ3kpO1xuICAgIHRoaXMuZXhlY3V0b3JzLnB1c2goZXhlY3V0b3IpO1xuICAgIHJldHVybiBleGVjdXRvcjtcbiAgfSBcbn1cblxuLy8gRXhwb3NlIHN1cHBvcnQgY2xhc3NlcyAvIGNvbnN0YW50c1xuT3BlblZWLlZpZXdhYmlsaXR5Q3JpdGVyaWEgPSBWaWV3YWJpbGl0eUNyaXRlcmlhO1xuLy8gT3BlblZWLk1lYXN1cmVhYmxlRWxlbWVudCA9IE1lYXN1cmVhYmxlRWxlbWVudDsiLCJleHBvcnQgY29uc3QgTVJDX1ZJREVPID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMjAwMFxufTtcblxuZXhwb3J0IGNvbnN0IE1SQ19ESVNQTEFZID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMTAwMFxufTtcblxuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldykgPT4gKHsgaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3IH0pOyIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEluVmlld1RpbWVyIHtcbiAgY29uc3RydWN0b3IoZHVyYXRpb24pIHtcbiAgICB0aGlzLmR1cmF0aW9uID0gZHVyYXRpb247ICAgICAgXG4gICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IGZhbHNlO1xuICB9XG5cbiAgdGltZXJDb21wbGV0ZSgpIHtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IHRydWU7XG4gICAgdGhpcy5saXN0ZW5lcnMuZm9yRWFjaCggbCA9PiBsKCkgKTtcbiAgfVxuXG4gIGVsYXBzZWQoY2IpIHtcbiAgICBpZih0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnB1c2goY2IpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcbiAgICB9XG4gICAgdGhpcy50aW1lciA9IHNldFRpbWVvdXQodGhpcy50aW1lckNvbXBsZXRlLmJpbmQodGhpcyksdGhpcy5kdXJhdGlvbik7XG4gIH1cblxuICBwYXVzZSgpIHtcbiAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lcik7XG4gIH1cblxuICByZXN1bWUoKSB7XG4gICAgdGhpcy50aW1lciA9IHNldFRpbWVvdXQodGhpcy50aW1lckNvbXBsZXRlLmJpbmQodGhpcyksdGhpcy5kdXJhdGlvbik7XG4gIH1cblxufSJdfQ==
