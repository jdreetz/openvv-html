(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.OpenVV = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

(function(window, document) {
'use strict';


// Exits early if all IntersectionObserver and IntersectionObserverEntry
// features are natively supported.
if ('IntersectionObserver' in window &&
    'IntersectionObserverEntry' in window &&
    'intersectionRatio' in window.IntersectionObserverEntry.prototype) {
  return;
}


/**
 * An IntersectionObserver registry. This registry exists to hold a strong
 * reference to IntersectionObserver instances currently observering a target
 * element. Without this registry, instances without another reference may be
 * garbage collected.
 */
var registry = [];


/**
 * Creates the global IntersectionObserverEntry constructor.
 * https://wicg.github.io/IntersectionObserver/#intersection-observer-entry
 * @param {Object} entry A dictionary of instance properties.
 * @constructor
 */
function IntersectionObserverEntry(entry) {
  this.time = entry.time;
  this.target = entry.target;
  this.rootBounds = entry.rootBounds;
  this.boundingClientRect = entry.boundingClientRect;
  this.intersectionRect = entry.intersectionRect || getEmptyRect();
  this.isIntersecting = !!entry.intersectionRect;

  // Calculates the intersection ratio.
  var targetRect = this.boundingClientRect;
  var targetArea = targetRect.width * targetRect.height;
  var intersectionRect = this.intersectionRect;
  var intersectionArea = intersectionRect.width * intersectionRect.height;

  // Sets intersection ratio.
  if (targetArea) {
    this.intersectionRatio = intersectionArea / targetArea;
  } else {
    // If area is zero and is intersecting, sets to 1, otherwise to 0
    this.intersectionRatio = this.isIntersecting ? 1 : 0;
  }
}


/**
 * Creates the global IntersectionObserver constructor.
 * https://wicg.github.io/IntersectionObserver/#intersection-observer-interface
 * @param {Function} callback The function to be invoked after intersection
 *     changes have queued. The function is not invoked if the queue has
 *     been emptied by calling the `takeRecords` method.
 * @param {Object=} opt_options Optional configuration options.
 * @constructor
 */
function IntersectionObserver(callback, opt_options) {

  var options = opt_options || {};

  if (typeof callback != 'function') {
    throw new Error('callback must be a function');
  }

  if (options.root && options.root.nodeType != 1) {
    throw new Error('root must be an Element');
  }

  // Binds and throttles `this._checkForIntersections`.
  this._checkForIntersections = throttle(
      this._checkForIntersections.bind(this), this.THROTTLE_TIMEOUT);

  // Private properties.
  this._callback = callback;
  this._observationTargets = [];
  this._queuedEntries = [];
  this._rootMarginValues = this._parseRootMargin(options.rootMargin);

  // Public properties.
  this.thresholds = this._initThresholds(options.threshold);
  this.root = options.root || null;
  this.rootMargin = this._rootMarginValues.map(function(margin) {
    return margin.value + margin.unit;
  }).join(' ');
}


/**
 * The minimum interval within which the document will be checked for
 * intersection changes.
 */
IntersectionObserver.prototype.THROTTLE_TIMEOUT = 100;


/**
 * The frequency in which the polyfill polls for intersection changes.
 * this can be updated on a per instance basis and must be set prior to
 * calling `observe` on the first target.
 */
IntersectionObserver.prototype.POLL_INTERVAL = null;


/**
 * Starts observing a target element for intersection changes based on
 * the thresholds values.
 * @param {Element} target The DOM element to observe.
 */
IntersectionObserver.prototype.observe = function(target) {
  // If the target is already being observed, do nothing.
  if (this._observationTargets.some(function(item) {
    return item.element == target;
  })) {
    return;
  }

  if (!(target && target.nodeType == 1)) {
    throw new Error('target must be an Element');
  }

  this._registerInstance();
  this._observationTargets.push({element: target, entry: null});
  this._monitorIntersections();
};


/**
 * Stops observing a target element for intersection changes.
 * @param {Element} target The DOM element to observe.
 */
IntersectionObserver.prototype.unobserve = function(target) {
  this._observationTargets =
      this._observationTargets.filter(function(item) {

    return item.element != target;
  });
  if (!this._observationTargets.length) {
    this._unmonitorIntersections();
    this._unregisterInstance();
  }
};


/**
 * Stops observing all target elements for intersection changes.
 */
IntersectionObserver.prototype.disconnect = function() {
  this._observationTargets = [];
  this._unmonitorIntersections();
  this._unregisterInstance();
};


/**
 * Returns any queue entries that have not yet been reported to the
 * callback and clears the queue. This can be used in conjunction with the
 * callback to obtain the absolute most up-to-date intersection information.
 * @return {Array} The currently queued entries.
 */
IntersectionObserver.prototype.takeRecords = function() {
  var records = this._queuedEntries.slice();
  this._queuedEntries = [];
  return records;
};


/**
 * Accepts the threshold value from the user configuration object and
 * returns a sorted array of unique threshold values. If a value is not
 * between 0 and 1 and error is thrown.
 * @private
 * @param {Array|number=} opt_threshold An optional threshold value or
 *     a list of threshold values, defaulting to [0].
 * @return {Array} A sorted list of unique and valid threshold values.
 */
IntersectionObserver.prototype._initThresholds = function(opt_threshold) {
  var threshold = opt_threshold || [0];
  if (!Array.isArray(threshold)) threshold = [threshold];

  return threshold.sort().filter(function(t, i, a) {
    if (typeof t != 'number' || isNaN(t) || t < 0 || t > 1) {
      throw new Error('threshold must be a number between 0 and 1 inclusively');
    }
    return t !== a[i - 1];
  });
};


/**
 * Accepts the rootMargin value from the user configuration object
 * and returns an array of the four margin values as an object containing
 * the value and unit properties. If any of the values are not properly
 * formatted or use a unit other than px or %, and error is thrown.
 * @private
 * @param {string=} opt_rootMargin An optional rootMargin value,
 *     defaulting to '0px'.
 * @return {Array<Object>} An array of margin objects with the keys
 *     value and unit.
 */
IntersectionObserver.prototype._parseRootMargin = function(opt_rootMargin) {
  var marginString = opt_rootMargin || '0px';
  var margins = marginString.split(/\s+/).map(function(margin) {
    var parts = /^(-?\d*\.?\d+)(px|%)$/.exec(margin);
    if (!parts) {
      throw new Error('rootMargin must be specified in pixels or percent');
    }
    return {value: parseFloat(parts[1]), unit: parts[2]};
  });

  // Handles shorthand.
  margins[1] = margins[1] || margins[0];
  margins[2] = margins[2] || margins[0];
  margins[3] = margins[3] || margins[1];

  return margins;
};


/**
 * Starts polling for intersection changes if the polling is not already
 * happening, and if the page's visibilty state is visible.
 * @private
 */
IntersectionObserver.prototype._monitorIntersections = function() {
  if (!this._monitoringIntersections) {
    this._monitoringIntersections = true;

    this._checkForIntersections();

    // If a poll interval is set, use polling instead of listening to
    // resize and scroll events or DOM mutations.
    if (this.POLL_INTERVAL) {
      this._monitoringInterval = setInterval(
          this._checkForIntersections, this.POLL_INTERVAL);
    }
    else {
      addEvent(window, 'resize', this._checkForIntersections, true);
      addEvent(document, 'scroll', this._checkForIntersections, true);

      if ('MutationObserver' in window) {
        this._domObserver = new MutationObserver(this._checkForIntersections);
        this._domObserver.observe(document, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true
        });
      }
    }
  }
};


/**
 * Stops polling for intersection changes.
 * @private
 */
IntersectionObserver.prototype._unmonitorIntersections = function() {
  if (this._monitoringIntersections) {
    this._monitoringIntersections = false;

    clearInterval(this._monitoringInterval);
    this._monitoringInterval = null;

    removeEvent(window, 'resize', this._checkForIntersections, true);
    removeEvent(document, 'scroll', this._checkForIntersections, true);

    if (this._domObserver) {
      this._domObserver.disconnect();
      this._domObserver = null;
    }
  }
};


/**
 * Scans each observation target for intersection changes and adds them
 * to the internal entries queue. If new entries are found, it
 * schedules the callback to be invoked.
 * @private
 */
IntersectionObserver.prototype._checkForIntersections = function() {
  var rootIsInDom = this._rootIsInDom();
  var rootRect = rootIsInDom ? this._getRootRect() : getEmptyRect();

  this._observationTargets.forEach(function(item) {
    var target = item.element;
    var targetRect = getBoundingClientRect(target);
    var rootContainsTarget = this._rootContainsTarget(target);
    var oldEntry = item.entry;
    var intersectionRect = rootIsInDom && rootContainsTarget &&
        this._computeTargetAndRootIntersection(target, rootRect);

    var newEntry = item.entry = new IntersectionObserverEntry({
      time: now(),
      target: target,
      boundingClientRect: targetRect,
      rootBounds: rootRect,
      intersectionRect: intersectionRect
    });

    if (!oldEntry) {
      this._queuedEntries.push(newEntry);
    } else if (rootIsInDom && rootContainsTarget) {
      // If the new entry intersection ratio has crossed any of the
      // thresholds, add a new entry.
      if (this._hasCrossedThreshold(oldEntry, newEntry)) {
        this._queuedEntries.push(newEntry);
      }
    } else {
      // If the root is not in the DOM or target is not contained within
      // root but the previous entry for this target had an intersection,
      // add a new record indicating removal.
      if (oldEntry && oldEntry.isIntersecting) {
        this._queuedEntries.push(newEntry);
      }
    }
  }, this);

  if (this._queuedEntries.length) {
    this._callback(this.takeRecords(), this);
  }
};


/**
 * Accepts a target and root rect computes the intersection between then
 * following the algorithm in the spec.
 * TODO(philipwalton): at this time clip-path is not considered.
 * https://wicg.github.io/IntersectionObserver/#calculate-intersection-rect-algo
 * @param {Element} target The target DOM element
 * @param {Object} rootRect The bounding rect of the root after being
 *     expanded by the rootMargin value.
 * @return {?Object} The final intersection rect object or undefined if no
 *     intersection is found.
 * @private
 */
IntersectionObserver.prototype._computeTargetAndRootIntersection =
    function(target, rootRect) {

  // If the element isn't displayed, an intersection can't happen.
  if (window.getComputedStyle(target).display == 'none') return;

  var targetRect = getBoundingClientRect(target);
  var intersectionRect = targetRect;
  var parent = target.parentNode;
  var atRoot = false;

  while (!atRoot) {
    var parentRect = null;

    // If we're at the root element, set parentRect to the already
    // calculated rootRect. And since <body> and <html> cannot be clipped
    // to a rect that's not also the document rect, consider them root too.
    if (parent == this.root ||
        parent == document.body ||
        parent == document.documentElement ||
        parent.nodeType != 1) {
      atRoot = true;
      parentRect = rootRect;
    }
    // Otherwise check to see if the parent element hides overflow,
    // and if so update parentRect.
    else {
      if (window.getComputedStyle(parent).overflow != 'visible') {
        parentRect = getBoundingClientRect(parent);
      }
    }
    // If either of the above conditionals set a new parentRect,
    // calculate new intersection data.
    if (parentRect) {
      intersectionRect = computeRectIntersection(parentRect, intersectionRect);

      if (!intersectionRect) break;
    }
    parent = parent.parentNode;
  }
  return intersectionRect;
};


/**
 * Returns the root rect after being expanded by the rootMargin value.
 * @return {Object} The expanded root rect.
 * @private
 */
IntersectionObserver.prototype._getRootRect = function() {
  var rootRect;
  if (this.root) {
    rootRect = getBoundingClientRect(this.root);
  } else {
    // Use <html>/<body> instead of window since scroll bars affect size.
    var html = document.documentElement;
    var body = document.body;
    rootRect = {
      top: 0,
      left: 0,
      right: html.clientWidth || body.clientWidth,
      width: html.clientWidth || body.clientWidth,
      bottom: html.clientHeight || body.clientHeight,
      height: html.clientHeight || body.clientHeight
    };
  }
  return this._expandRectByRootMargin(rootRect);
};


/**
 * Accepts a rect and expands it by the rootMargin value.
 * @param {Object} rect The rect object to expand.
 * @return {Object} The expanded rect.
 * @private
 */
IntersectionObserver.prototype._expandRectByRootMargin = function(rect) {
  var margins = this._rootMarginValues.map(function(margin, i) {
    return margin.unit == 'px' ? margin.value :
        margin.value * (i % 2 ? rect.width : rect.height) / 100;
  });
  var newRect = {
    top: rect.top - margins[0],
    right: rect.right + margins[1],
    bottom: rect.bottom + margins[2],
    left: rect.left - margins[3]
  };
  newRect.width = newRect.right - newRect.left;
  newRect.height = newRect.bottom - newRect.top;

  return newRect;
};


/**
 * Accepts an old and new entry and returns true if at least one of the
 * threshold values has been crossed.
 * @param {?IntersectionObserverEntry} oldEntry The previous entry for a
 *    particular target element or null if no previous entry exists.
 * @param {IntersectionObserverEntry} newEntry The current entry for a
 *    particular target element.
 * @return {boolean} Returns true if a any threshold has been crossed.
 * @private
 */
IntersectionObserver.prototype._hasCrossedThreshold =
    function(oldEntry, newEntry) {

  // To make comparing easier, an entry that has a ratio of 0
  // but does not actually intersect is given a value of -1
  var oldRatio = oldEntry && oldEntry.isIntersecting ?
      oldEntry.intersectionRatio || 0 : -1;
  var newRatio = newEntry.isIntersecting ?
      newEntry.intersectionRatio || 0 : -1;

  // Ignore unchanged ratios
  if (oldRatio === newRatio) return;

  for (var i = 0; i < this.thresholds.length; i++) {
    var threshold = this.thresholds[i];

    // Return true if an entry matches a threshold or if the new ratio
    // and the old ratio are on the opposite sides of a threshold.
    if (threshold == oldRatio || threshold == newRatio ||
        threshold < oldRatio !== threshold < newRatio) {
      return true;
    }
  }
};


/**
 * Returns whether or not the root element is an element and is in the DOM.
 * @return {boolean} True if the root element is an element and is in the DOM.
 * @private
 */
IntersectionObserver.prototype._rootIsInDom = function() {
  return !this.root || containsDeep(document, this.root);
};


/**
 * Returns whether or not the target element is a child of root.
 * @param {Element} target The target element to check.
 * @return {boolean} True if the target element is a child of root.
 * @private
 */
IntersectionObserver.prototype._rootContainsTarget = function(target) {
  return containsDeep(this.root || document, target);
};


/**
 * Adds the instance to the global IntersectionObserver registry if it isn't
 * already present.
 * @private
 */
IntersectionObserver.prototype._registerInstance = function() {
  if (registry.indexOf(this) < 0) {
    registry.push(this);
  }
};


/**
 * Removes the instance from the global IntersectionObserver registry.
 * @private
 */
IntersectionObserver.prototype._unregisterInstance = function() {
  var index = registry.indexOf(this);
  if (index != -1) registry.splice(index, 1);
};


/**
 * Returns the result of the performance.now() method or null in browsers
 * that don't support the API.
 * @return {number} The elapsed time since the page was requested.
 */
function now() {
  return window.performance && performance.now && performance.now();
}


/**
 * Throttles a function and delays its executiong, so it's only called at most
 * once within a given time period.
 * @param {Function} fn The function to throttle.
 * @param {number} timeout The amount of time that must pass before the
 *     function can be called again.
 * @return {Function} The throttled function.
 */
function throttle(fn, timeout) {
  var timer = null;
  return function () {
    if (!timer) {
      timer = setTimeout(function() {
        fn();
        timer = null;
      }, timeout);
    }
  };
}


/**
 * Adds an event handler to a DOM node ensuring cross-browser compatibility.
 * @param {Node} node The DOM node to add the event handler to.
 * @param {string} event The event name.
 * @param {Function} fn The event handler to add.
 * @param {boolean} opt_useCapture Optionally adds the even to the capture
 *     phase. Note: this only works in modern browsers.
 */
function addEvent(node, event, fn, opt_useCapture) {
  if (typeof node.addEventListener == 'function') {
    node.addEventListener(event, fn, opt_useCapture || false);
  }
  else if (typeof node.attachEvent == 'function') {
    node.attachEvent('on' + event, fn);
  }
}


/**
 * Removes a previously added event handler from a DOM node.
 * @param {Node} node The DOM node to remove the event handler from.
 * @param {string} event The event name.
 * @param {Function} fn The event handler to remove.
 * @param {boolean} opt_useCapture If the event handler was added with this
 *     flag set to true, it should be set to true here in order to remove it.
 */
function removeEvent(node, event, fn, opt_useCapture) {
  if (typeof node.removeEventListener == 'function') {
    node.removeEventListener(event, fn, opt_useCapture || false);
  }
  else if (typeof node.detatchEvent == 'function') {
    node.detatchEvent('on' + event, fn);
  }
}


/**
 * Returns the intersection between two rect objects.
 * @param {Object} rect1 The first rect.
 * @param {Object} rect2 The second rect.
 * @return {?Object} The intersection rect or undefined if no intersection
 *     is found.
 */
function computeRectIntersection(rect1, rect2) {
  var top = Math.max(rect1.top, rect2.top);
  var bottom = Math.min(rect1.bottom, rect2.bottom);
  var left = Math.max(rect1.left, rect2.left);
  var right = Math.min(rect1.right, rect2.right);
  var width = right - left;
  var height = bottom - top;

  return (width >= 0 && height >= 0) && {
    top: top,
    bottom: bottom,
    left: left,
    right: right,
    width: width,
    height: height
  };
}


/**
 * Shims the native getBoundingClientRect for compatibility with older IE.
 * @param {Element} el The element whose bounding rect to get.
 * @return {Object} The (possibly shimmed) rect of the element.
 */
function getBoundingClientRect(el) {
  var rect;

  try {
    rect = el.getBoundingClientRect();
  } catch (err) {
    // Ignore Windows 7 IE11 "Unspecified error"
    // https://github.com/WICG/IntersectionObserver/pull/205
  }

  if (!rect) return getEmptyRect();

  // Older IE
  if (!(rect.width && rect.height)) {
    rect = {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    };
  }
  return rect;
}


/**
 * Returns an empty rect object. An empty rect is returned when an element
 * is not in the DOM.
 * @return {Object} The empty rect.
 */
function getEmptyRect() {
  return {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0
  };
}

/**
 * Checks to see if a parent element contains a child elemnt (including inside
 * shadow DOM).
 * @param {Node} parent The parent element.
 * @param {Node} child The child element.
 * @return {boolean} True if the parent node contains the child node.
 */
function containsDeep(parent, child) {
  var node = child;
  while (node) {
    // Check if the node is a shadow root, if it is get the host.
    if (node.nodeType == 11 && node.host) {
      node = node.host;
    }

    if (node == parent) return true;

    // Traverse upwards in the DOM.
    node = node.parentNode;
  }
  return false;
}


// Exposes the constructors globally.
window.IntersectionObserver = IntersectionObserver;
window.IntersectionObserverEntry = IntersectionObserverEntry;

}(window, document));

},{}],2:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var getDetails = exports.getDetails = function getDetails(element) {
  return {
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth),
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight),
    elementWidth: element.clientWidth,
    elementHeight: element.clientHeight,
    iframeContext: iFrameContext(),
    focus: isInFocus()
  };
};

var isInFocus = exports.isInFocus = function isInFocus() {
  if (document.hidden !== 'undefined') {
    if (document.hidden === true) {
      return false;
    }
  }

  if (iFrameContext() === iFrameServingScenarios.CROSS_DOMAIN_IFRAME) {
    return true;
  }

  if (window.document.hasFocus) {
    return window.top.document.hasFocus();
  }

  return true;
};

var iFrameContext = exports.iFrameContext = function iFrameContext() {
  try {
    if (window.top === window) {
      return iFrameServingScenarios.ON_PAGE;
    }

    var curWin = window,
        level = 0;
    while (curWin.parent !== curWin && level < 1000) {
      if (curWin.parent.document.domain !== curWin.document.domain) {
        return iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
      }

      curWin = curWin.parent;
    }
    iFrameServingScenarios.SAME_DOMAIN_IFRAME;
  } catch (e) {
    return iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
  }
};

var iFrameServingScenarios = exports.iFrameServingScenarios = {
  ON_PAGE: 'on page',
  SAME_DOMAIN_IFRAME: 'same domain iframe',
  CROSS_DOMAIN_IFRAME: 'cross domain iframe'
};

},{}],3:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.validateStrategy = exports.validateCriteria = exports.validElement = exports.validTechnique = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _BaseTechnique = require('../Measurement/MeasurementTechniques/BaseTechnique');

var _BaseTechnique2 = _interopRequireDefault(_BaseTechnique);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ensure technique atleast has the same properties and methods of AbstractTimer
var validTechnique = exports.validTechnique = function validTechnique(technique) {
  var valid = typeof technique === 'function' && Object.getOwnPropertyNames(_BaseTechnique2.default).reduce(function (prop, valid) {
    return valid && _typeof(technique[prop]) === _typeof(_BaseTechnique2.default[prop]);
  }, true);

  return valid;
};

var validElement = exports.validElement = function validElement(element) {
  return element && element.toString().indexOf('Element') > -1;
};

var validateCriteria = exports.validateCriteria = function validateCriteria(_ref) {
  var inViewThreshold = _ref.inViewThreshold,
      timeInView = _ref.timeInView;

  var invalid = false,
      reasons = [];

  if (typeof inViewThreshold !== 'number' || inViewThreshold > 1) {
    invalid = true;
    reasons.push('inViewThreshold must be a number equal to or less than 1');
  }

  if (typeof timeInView !== 'number' || timeInView < 0) {
    invalid = true;
    reasons.push('timeInView must be a number greater to or equal 0');
  }

  return { invalid: invalid, reasons: reasons.join(' | ') };
};

var validateStrategy = exports.validateStrategy = function validateStrategy(_ref2) {
  var autostart = _ref2.autostart,
      techniques = _ref2.techniques,
      criteria = _ref2.criteria;

  var invalid = false,
      reasons = [];

  if (typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if (!Array.isArray(techniques) || techniques.length === 0) {
    invalid = true;
    reasons.push('techniques must be an array containing atleast on measurement techniques');
  }

  var validated = validateCriteria(criteria);

  if (validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid: invalid, reasons: reasons.join(' | ') };
};

},{"../Measurement/MeasurementTechniques/BaseTechnique":6}],4:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
var START = exports.START = 'start';
var STOP = exports.STOP = 'stop';
var CHANGE = exports.CHANGE = 'change';
var COMPLETE = exports.COMPLETE = 'complete';
var UNMEASUREABLE = exports.UNMEASUREABLE = 'unmeasureable';
var INVIEW = exports.INVIEW = 'inview';
var OUTVIEW = exports.OUTVIEW = 'outview';

},{}],5:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _InViewTimer = require('../Timing/InViewTimer');

var _InViewTimer2 = _interopRequireDefault(_InViewTimer);

var _Strategies = require('./Strategies/');

var _Validators = require('../Helpers/Validators');

var _Environment = require('../Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

var _Events = require('./Events');

var Events = _interopRequireWildcard(_Events);

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

    var strategy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, MeasurementExecutor);

    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    this._element = element;
    this._strategy = _extends({}, _Strategies.defaultStrategy, strategy);
    this._criteriaMet = false;

    var validated = (0, _Validators.validateStrategy)(this._strategy);

    if (validated.invalid) {
      throw validated.reasons;
    }

    this._technique = this._selectTechnique(this._strategy.techniques);

    if (this._technique) {
      this._addSubscriptions(this._technique);
    }

    if (this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout(function () {
        return _this._publish(Events.UNMEASUREABLE, Environment.getDetails(_this._element));
      }, 0);
    } else if (this._strategy.autostart) {
      this._technique.start();
    }
  }

  _createClass(MeasurementExecutor, [{
    key: 'start',
    value: function start() {
      this._technique.start();
    }
  }, {
    key: 'dispose',
    value: function dispose() {
      if (this._technique) {
        this._technique.dispose();
      }
      if (this.timer) {
        this.timer.dispose();
      }
    }

    // Expose callback interfaces to API consumer

  }, {
    key: 'onViewableStart',
    value: function onViewableStart(callback) {
      return this._addCallback(callback, Events.START);
    }
  }, {
    key: 'onViewableStop',
    value: function onViewableStop(callback) {
      return this._addCallback(callback, Events.STOP);
    }
  }, {
    key: 'onViewableChange',
    value: function onViewableChange(callback) {
      return this._addCallback(callback, Events.CHANGE);
    }
  }, {
    key: 'onViewableComplete',
    value: function onViewableComplete(callback) {
      return this._addCallback(callback, Events.COMPLETE);
    }
  }, {
    key: 'onUnmeasureable',
    value: function onUnmeasureable(callback) {
      return this._addCallback(callback, Events.UNMEASUREABLE);
    }
  }, {
    key: '_selectTechnique',


    // select first technique that is not unmeasureable
    value: function _selectTechnique(techniques) {
      return techniques.filter(_Validators.validTechnique).map(this._instantiateTechnique.bind(this)).find(function (technique) {
        return !technique.unmeasureable;
      });
    }
  }, {
    key: '_instantiateTechnique',
    value: function _instantiateTechnique(technique) {
      return new technique(element, this._strategy.criteria);
    }
  }, {
    key: '_addSubscriptions',
    value: function _addSubscriptions(technique) {
      if (technique) {
        technique.onInView(this._techniqueChange.bind(this, Events.INVIEW, technique));
        technique.onChangeView(this._techniqueChange.bind(this, Events.CHANGE, technique));
        technique.onOutView(this._techniqueChange.bind(this, Events.OUTVIEW, technique));
      }
    }
  }, {
    key: '_techniqueChange',
    value: function _techniqueChange(change, technique) {
      var eventName = void 0;
      var details = this._appendEnvironment(technique);

      switch (change) {
        case Events.INVIEW:
          if (!this._criteriaMet) {
            this.timer = new _InViewTimer2.default(this._strategy.criteria.timeInView);
            this.timer.elapsed(this._timerElapsed.bind(this, technique));
            this.timer.start();
            eventName = Events.START;
          }

          break;

        case Events.CHANGE:
          eventName = change;
          break;

        case Events.COMPLETE:
          if (!this._criteriaMet) {
            this._criteriaMet = true;
            eventName = change;
          }

          break;

        case Events.OUTVIEW:
          if (!this._criteriaMet) {
            if (this.timer) {
              this.timer.stop();
              delete this.timer;
            }
            eventName = Events.STOP;
          }

          break;
      }

      if (eventName) {
        this._publish(eventName, details);
      }
    }
  }, {
    key: '_publish',
    value: function _publish(event, value) {
      if (Array.isArray(this._listeners[event])) {
        this._listeners[event].forEach(function (l) {
          return l(value);
        });
      }
    }
  }, {
    key: '_timerElapsed',
    value: function _timerElapsed(technique) {
      this._techniqueChange(Events.COMPLETE, technique);
    }
  }, {
    key: '_addCallback',
    value: function _addCallback(callback, event) {
      if (this._listeners[event] && typeof callback === 'function') {
        this._listeners[event].push(callback);
      } else if (typeof callback !== 'function') {
        throw 'Callback must be a function';
      }

      return this;
    }
  }, {
    key: '_appendEnvironment',
    value: function _appendEnvironment(technique) {
      return _extends({}, {
        percentViewable: technique.percentViewable,
        technique: technique.techniqueName,
        viewable: technique.viewable
      }, Environment.getDetails(this._element));
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return !this._technique || this._technique.unmeasureable;
    }
  }]);

  return MeasurementExecutor;
}();

exports.default = MeasurementExecutor;
module.exports = exports['default'];

},{"../Environment/Environment":2,"../Helpers/Validators":3,"../Timing/InViewTimer":14,"./Events":4,"./Strategies/":11}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BaseTechnique = function () {
  function BaseTechnique() {
    _classCallCheck(this, BaseTechnique);

    this.listeners = {
      inView: [],
      outView: [],
      changeView: []
    };

    this.percentViewable = 0.0;
  }

  // element is in view according to strategy defined by concrete measurement class


  _createClass(BaseTechnique, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }
  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'changeView');
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
      } else if (typeof callback !== 'function') {
        throw 'callback must be function';
      }

      return this;
    }
  }, {
    key: 'dispose',
    value: function dispose() {}
  }, {
    key: 'unmeasureable',
    get: function get() {
      return false;
    }
  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }
  }, {
    key: 'techniqueName',
    get: function get() {
      return 'BaseTechnique';
    }
  }]);

  return BaseTechnique;
}();

exports.default = BaseTechnique;
module.exports = exports['default'];

},{}],7:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BaseTechnique = function () {
  function BaseTechnique() {
    _classCallCheck(this, BaseTechnique);

    this.listeners = {
      inView: [],
      outView: [],
      changeView: []
    };

    this.percentViewable = 0.0;
  }

  // element is in view according to strategy defined by concrete measurement class


  _createClass(BaseTechnique, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }
  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'changeView');
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
      } else if (typeof callback !== 'function') {
        throw 'callback must be function';
      }

      return this;
    }
  }, {
    key: 'dispose',
    value: function dispose() {}
  }, {
    key: 'unmeasureable',
    get: function get() {
      return false;
    }
  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }
  }, {
    key: 'techniqueName',
    get: function get() {
      return 'BaseTechnique';
    }
  }]);

  return BaseTechnique;
}();

exports.default = BaseTechnique;
module.exports = exports['default'];

},{}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Basetechnique2 = require('./Basetechnique');

var _Basetechnique3 = _interopRequireDefault(_Basetechnique2);

var _Validators = require('../../Helpers/Validators');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var IntersectionObserver = function (_Basetechnique) {
  _inherits(IntersectionObserver, _Basetechnique);

  function IntersectionObserver(element, criteria) {
    _classCallCheck(this, IntersectionObserver);

    var _this = _possibleConstructorReturn(this, (IntersectionObserver.__proto__ || Object.getPrototypeOf(IntersectionObserver)).call(this, element, criteria));

    if (criteria !== undefined && element) {
      _this.element = element;
      _this.criteria = criteria;
      _this.inView = false;
      _this.started = false;
      _this.notificationLevels = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
      if (_this.notificationLevels.indexOf(_this.criteria.inViewThreshold) === -1) {
        _this.notificationLevels.push(_this.criteria.inViewThreshold);
      }
    } else if (!element) {
      throw 'element not provided';
    } else if (!criteria) {
      throw 'criteria not provided';
    }
    return _this;
  }

  _createClass(IntersectionObserver, [{
    key: 'start',
    value: function start() {
      this.observer = new window.IntersectionObserver(this.viewableChange.bind(this), { threshold: this.notificationLevels });
      this.observer.observe(this.element);
    }
  }, {
    key: 'dispose',
    value: function dispose() {
      if (this.observer) {
        this.observer.unobserve(element);
        this.observer.disconnect(element);
      }
    }
  }, {
    key: 'viewableChange',
    value: function viewableChange(entries) {
      if (entries && entries.length && entries[0].intersectionRatio !== undefined) {
        this.percentViewable = entries[0].intersectionRatio;

        if (entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
          this.inView = false;
          this.listeners.outView.forEach(function (l) {
            return l();
          });
        }
        if (entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
          this.started = true;
          this.inView = true;
          this.listeners.inView.forEach(function (l) {
            return l();
          });
        }

        this.listeners.changeView.forEach(function (l) {
          return l();
        });
      }
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return !window.IntersectionObserver || this.usesPolyfill || !(0, _Validators.validElement)(this.element);
    }
  }, {
    key: 'viewable',
    get: function get() {
      return this.inView;
    }
  }, {
    key: 'techniqueName',
    get: function get() {
      return 'IntersectionObserver';
    }

    // infer polyfill usage by checking if IntersectionObserver API has THROTTLE_TIMEOUT memmber

  }, {
    key: 'usesPolyfill',
    get: function get() {
      return typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number';
    }
  }]);

  return IntersectionObserver;
}(_Basetechnique3.default);

exports.default = IntersectionObserver;
module.exports = exports['default'];

},{"../../Helpers/Validators":3,"./Basetechnique":7}],9:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _IntersectionObserver2 = require('./IntersectionObserver');

var _IntersectionObserver3 = _interopRequireDefault(_IntersectionObserver2);

var _intersectionObserver = require('intersection-observer');

var _intersectionObserver2 = _interopRequireDefault(_intersectionObserver);

var _Environment = require('../../Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

// We only need to override a few aspects of the native implementation's measurer
var IntersectionObserverPolyfill = function (_IntersectionObserver) {
  _inherits(IntersectionObserverPolyfill, _IntersectionObserver);

  function IntersectionObserverPolyfill() {
    _classCallCheck(this, IntersectionObserverPolyfill);

    return _possibleConstructorReturn(this, (IntersectionObserverPolyfill.__proto__ || Object.getPrototypeOf(IntersectionObserverPolyfill)).apply(this, arguments));
  }

  _createClass(IntersectionObserverPolyfill, [{
    key: 'unmeasureable',
    get: function get() {
      return Environment.iFrameContext() === Environment.iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
    }
  }, {
    key: 'techniqueName',
    get: function get() {
      return 'IntersectionObserverPolyFill';
    }
  }]);

  return IntersectionObserverPolyfill;
}(_IntersectionObserver3.default);

exports.default = IntersectionObserverPolyfill;
module.exports = exports['default'];

},{"../../Environment/Environment":2,"./IntersectionObserver":8,"intersection-observer":1}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _IntersectionObserver = require('./IntersectionObserver');

Object.defineProperty(exports, 'IntersectionObserver', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IntersectionObserver).default;
  }
});

var _IntersectionObserverPolyfill = require('./IntersectionObserverPolyfill');

Object.defineProperty(exports, 'IntersectionObserverPolyfill', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_IntersectionObserverPolyfill).default;
  }
});

var _BaseTechnique = require('./BaseTechnique');

Object.defineProperty(exports, 'BaseTechnique', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_BaseTechnique).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./BaseTechnique":6,"./IntersectionObserver":8,"./IntersectionObserverPolyfill":9}],11:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StrategyFactory = exports.defaultStrategy = undefined;

var _Validators = require('../../Helpers/Validators');

var Validators = _interopRequireWildcard(_Validators);

var _MeasurementTechniques = require('../MeasurementTechniques/');

var MeasurementTechniques = _interopRequireWildcard(_MeasurementTechniques);

var _ViewabilityCriteria = require('../../Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

var defaultStrategy = exports.defaultStrategy = {
  autostart: true,
  techniques: [MeasurementTechniques.IntersectionObserver, MeasurementTechniques.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

var StrategyFactory = exports.StrategyFactory = function StrategyFactory() {
  var autostart = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : defaultStrategy.autostart;
  var techniques = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : defaultStrategy.techniques;
  var criteria = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : defaultStrategy.criteria;

  var strategy = { autostart: autostart, techniques: techniques, criteria: criteria },
      validated = Validators.validateStrategy(strategy);

  if (validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};

},{"../../Helpers/Validators":3,"../../Options/ViewabilityCriteria":13,"../MeasurementTechniques/":10}],12:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _Events = require('./Measurement/Events');

var Events = _interopRequireWildcard(_Events);

var _InViewTimer = require('./Timing/InViewTimer');

var _InViewTimer2 = _interopRequireDefault(_InViewTimer);

var _Strategies = require('./Measurement/Strategies/');

var Strategies = _interopRequireWildcard(_Strategies);

var _Environment = require('./Environment/Environment');

var Environment = _interopRequireWildcard(_Environment);

var _MeasurementExecutor = require('./Measurement/MeasurementExecutor');

var _MeasurementExecutor2 = _interopRequireDefault(_MeasurementExecutor);

var _ViewabilityCriteria = require('./Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

var _MeasurementTechniques = require('./Measurement/MeasurementTechniques/');

var MeasurementTechniques = _interopRequireWildcard(_MeasurementTechniques);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/** Class represents the main entry point to the OpenVV library */
var OpenVV = function () {
  /**
   * Create a new instance of OpenVV 
   */
  function OpenVV() {
    _classCallCheck(this, OpenVV);

    this.executors = [];
  }

  /**
   * Allows measurement of an element using a strategy definition  
   * @param  {HTMLElement} element - the element you'd like measure viewability on
   * @param  {Object} strategy - an object representing the strategy to use for measurement. 
   * See OpenVV.Strategies for StrategyFactory and defaultStrategy for more information. 
   * @return {MeasurementExecutor} - returns instance of MeasurmentExecutor. 
   * This instance exposes event listeners onViewableStart, onViewableStop, onViewableChange, onViewableComplete, and onUnmeasureable
   * Also exposes start and dispose
   */


  _createClass(OpenVV, [{
    key: 'measureElement',
    value: function measureElement(element, strategy) {
      var executor = new _MeasurementExecutor2.default(element, strategy);
      this.executors.push(executor);
      return executor;
    }

    /**
     * destroys all measurement executors
     * @return {undefined}
     */

  }, {
    key: 'dispose',
    value: function dispose() {
      this.executors.forEach(function (e) {
        return e.dispose();
      });
    }
  }]);

  return OpenVV;
}();

/**
 * Exposes all public classes and constants available in the OpenVV package
 */


exports.default = OpenVV;
OpenVV.ViewabilityCriteria = ViewabilityCriteria;
OpenVV.MeasurementExecutor = _MeasurementExecutor2.default;
OpenVV.MeasurementTechniques = MeasurementTechniques;
OpenVV.InViewTimer = _InViewTimer2.default;
OpenVV.Strategies = Strategies;
OpenVV.Events = Events;
module.exports = exports['default'];

},{"./Environment/Environment":2,"./Measurement/Events":4,"./Measurement/MeasurementExecutor":5,"./Measurement/MeasurementTechniques/":10,"./Measurement/Strategies/":11,"./Options/ViewabilityCriteria":13,"./Timing/InViewTimer":14}],13:[function(require,module,exports){
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

},{}],14:[function(require,module,exports){
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
      this.endTimer();
      this.timer = setTimeout(this.timerComplete.bind(this), this.duration);
    }
  }, {
    key: 'stop',
    value: function stop() {
      this.endTimer();
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
  }, {
    key: 'endTimer',
    value: function endTimer() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.listeners.length = 0;
      }
    }
  }, {
    key: 'dispose',
    value: function dispose() {
      this.endTimer();
    }
  }]);

  return InViewTimer;
}();

exports.default = InViewTimer;
module.exports = exports['default'];

},{}]},{},[12])(12)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyYy9FbnZpcm9ubWVudC9FbnZpcm9ubWVudC5qcyIsInNyYy9IZWxwZXJzL1ZhbGlkYXRvcnMuanMiLCJzcmMvTWVhc3VyZW1lbnQvRXZlbnRzLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3IuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2VUZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2V0ZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0ludGVyc2VjdGlvbk9ic2VydmVyLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9pbmRleC5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL09wZW5WVi5qcyIsInNyYy9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEuanMiLCJzcmMvVGltaW5nL0luVmlld1RpbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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QSxPQUF4QjtBQUNEOzs7NEJBRU8sRSxFQUFJO0FBQ1YsVUFBRyxPQUFPLEVBQVAsS0FBYyxVQUFqQixFQUE2QjtBQUMzQixhQUFLLFNBQUwsQ0FBZSxJQUFmLENBQW9CLEVBQXBCO0FBQ0Q7QUFDRjs7OzRCQUVPO0FBQ04sV0FBSyxRQUFMO0FBQ0EsV0FBSyxLQUFMLEdBQWEsV0FBVyxLQUFLLGFBQUwsQ0FBbUIsSUFBbkIsQ0FBd0IsSUFBeEIsQ0FBWCxFQUEwQyxLQUFLLFFBQS9DLENBQWI7QUFDRDs7OzJCQUVNO0FBQ0wsV0FBSyxRQUFMO0FBQ0Q7Ozs0QkFFTztBQUNOLG1CQUFhLEtBQUssS0FBbEI7QUFDRDs7OzZCQUVRO0FBQ1AsV0FBSyxLQUFMLEdBQWEsV0FBVyxLQUFLLGFBQUwsQ0FBbUIsSUFBbkIsQ0FBd0IsSUFBeEIsQ0FBWCxFQUEwQyxLQUFLLFFBQS9DLENBQWI7QUFDRDs7OytCQUVVO0FBQ1QsVUFBRyxLQUFLLEtBQVIsRUFBZTtBQUNiLHFCQUFhLEtBQUssS0FBbEI7QUFDQSxhQUFLLFNBQUwsQ0FBZSxNQUFmLEdBQXdCLENBQXhCO0FBQ0Q7QUFDRjs7OzhCQUVTO0FBQ1IsV0FBSyxRQUFMO0FBQ0Q7Ozs7OztrQkE1Q2tCLFciLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLyoqXG4gKiBDb3B5cmlnaHQgMjAxNiBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG4oZnVuY3Rpb24od2luZG93LCBkb2N1bWVudCkge1xuJ3VzZSBzdHJpY3QnO1xuXG5cbi8vIEV4aXRzIGVhcmx5IGlmIGFsbCBJbnRlcnNlY3Rpb25PYnNlcnZlciBhbmQgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeVxuLy8gZmVhdHVyZXMgYXJlIG5hdGl2ZWx5IHN1cHBvcnRlZC5cbmlmICgnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInIGluIHdpbmRvdyAmJlxuICAgICdJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5JyBpbiB3aW5kb3cgJiZcbiAgICAnaW50ZXJzZWN0aW9uUmF0aW8nIGluIHdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5LnByb3RvdHlwZSkge1xuICByZXR1cm47XG59XG5cblxuLyoqXG4gKiBBbiBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeS4gVGhpcyByZWdpc3RyeSBleGlzdHMgdG8gaG9sZCBhIHN0cm9uZ1xuICogcmVmZXJlbmNlIHRvIEludGVyc2VjdGlvbk9ic2VydmVyIGluc3RhbmNlcyBjdXJyZW50bHkgb2JzZXJ2ZXJpbmcgYSB0YXJnZXRcbiAqIGVsZW1lbnQuIFdpdGhvdXQgdGhpcyByZWdpc3RyeSwgaW5zdGFuY2VzIHdpdGhvdXQgYW5vdGhlciByZWZlcmVuY2UgbWF5IGJlXG4gKiBnYXJiYWdlIGNvbGxlY3RlZC5cbiAqL1xudmFyIHJlZ2lzdHJ5ID0gW107XG5cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSBjb25zdHJ1Y3Rvci5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2ludGVyc2VjdGlvbi1vYnNlcnZlci1lbnRyeVxuICogQHBhcmFtIHtPYmplY3R9IGVudHJ5IEEgZGljdGlvbmFyeSBvZiBpbnN0YW5jZSBwcm9wZXJ0aWVzLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkoZW50cnkpIHtcbiAgdGhpcy50aW1lID0gZW50cnkudGltZTtcbiAgdGhpcy50YXJnZXQgPSBlbnRyeS50YXJnZXQ7XG4gIHRoaXMucm9vdEJvdW5kcyA9IGVudHJ5LnJvb3RCb3VuZHM7XG4gIHRoaXMuYm91bmRpbmdDbGllbnRSZWN0ID0gZW50cnkuYm91bmRpbmdDbGllbnRSZWN0O1xuICB0aGlzLmludGVyc2VjdGlvblJlY3QgPSBlbnRyeS5pbnRlcnNlY3Rpb25SZWN0IHx8IGdldEVtcHR5UmVjdCgpO1xuICB0aGlzLmlzSW50ZXJzZWN0aW5nID0gISFlbnRyeS5pbnRlcnNlY3Rpb25SZWN0O1xuXG4gIC8vIENhbGN1bGF0ZXMgdGhlIGludGVyc2VjdGlvbiByYXRpby5cbiAgdmFyIHRhcmdldFJlY3QgPSB0aGlzLmJvdW5kaW5nQ2xpZW50UmVjdDtcbiAgdmFyIHRhcmdldEFyZWEgPSB0YXJnZXRSZWN0LndpZHRoICogdGFyZ2V0UmVjdC5oZWlnaHQ7XG4gIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gdGhpcy5pbnRlcnNlY3Rpb25SZWN0O1xuICB2YXIgaW50ZXJzZWN0aW9uQXJlYSA9IGludGVyc2VjdGlvblJlY3Qud2lkdGggKiBpbnRlcnNlY3Rpb25SZWN0LmhlaWdodDtcblxuICAvLyBTZXRzIGludGVyc2VjdGlvbiByYXRpby5cbiAgaWYgKHRhcmdldEFyZWEpIHtcbiAgICB0aGlzLmludGVyc2VjdGlvblJhdGlvID0gaW50ZXJzZWN0aW9uQXJlYSAvIHRhcmdldEFyZWE7XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgYXJlYSBpcyB6ZXJvIGFuZCBpcyBpbnRlcnNlY3RpbmcsIHNldHMgdG8gMSwgb3RoZXJ3aXNlIHRvIDBcbiAgICB0aGlzLmludGVyc2VjdGlvblJhdGlvID0gdGhpcy5pc0ludGVyc2VjdGluZyA/IDEgOiAwO1xuICB9XG59XG5cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgY29uc3RydWN0b3IuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNpbnRlcnNlY3Rpb24tb2JzZXJ2ZXItaW50ZXJmYWNlXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdG8gYmUgaW52b2tlZCBhZnRlciBpbnRlcnNlY3Rpb25cbiAqICAgICBjaGFuZ2VzIGhhdmUgcXVldWVkLiBUaGUgZnVuY3Rpb24gaXMgbm90IGludm9rZWQgaWYgdGhlIHF1ZXVlIGhhc1xuICogICAgIGJlZW4gZW1wdGllZCBieSBjYWxsaW5nIHRoZSBgdGFrZVJlY29yZHNgIG1ldGhvZC5cbiAqIEBwYXJhbSB7T2JqZWN0PX0gb3B0X29wdGlvbnMgT3B0aW9uYWwgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICogQGNvbnN0cnVjdG9yXG4gKi9cbmZ1bmN0aW9uIEludGVyc2VjdGlvbk9ic2VydmVyKGNhbGxiYWNrLCBvcHRfb3B0aW9ucykge1xuXG4gIHZhciBvcHRpb25zID0gb3B0X29wdGlvbnMgfHwge307XG5cbiAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuXG4gIGlmIChvcHRpb25zLnJvb3QgJiYgb3B0aW9ucy5yb290Lm5vZGVUeXBlICE9IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Jvb3QgbXVzdCBiZSBhbiBFbGVtZW50Jyk7XG4gIH1cblxuICAvLyBCaW5kcyBhbmQgdGhyb3R0bGVzIGB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnNgLlxuICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMgPSB0aHJvdHRsZShcbiAgICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucy5iaW5kKHRoaXMpLCB0aGlzLlRIUk9UVExFX1RJTUVPVVQpO1xuXG4gIC8vIFByaXZhdGUgcHJvcGVydGllcy5cbiAgdGhpcy5fY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID0gW107XG4gIHRoaXMuX3F1ZXVlZEVudHJpZXMgPSBbXTtcbiAgdGhpcy5fcm9vdE1hcmdpblZhbHVlcyA9IHRoaXMuX3BhcnNlUm9vdE1hcmdpbihvcHRpb25zLnJvb3RNYXJnaW4pO1xuXG4gIC8vIFB1YmxpYyBwcm9wZXJ0aWVzLlxuICB0aGlzLnRocmVzaG9sZHMgPSB0aGlzLl9pbml0VGhyZXNob2xkcyhvcHRpb25zLnRocmVzaG9sZCk7XG4gIHRoaXMucm9vdCA9IG9wdGlvbnMucm9vdCB8fCBudWxsO1xuICB0aGlzLnJvb3RNYXJnaW4gPSB0aGlzLl9yb290TWFyZ2luVmFsdWVzLm1hcChmdW5jdGlvbihtYXJnaW4pIHtcbiAgICByZXR1cm4gbWFyZ2luLnZhbHVlICsgbWFyZ2luLnVuaXQ7XG4gIH0pLmpvaW4oJyAnKTtcbn1cblxuXG4vKipcbiAqIFRoZSBtaW5pbXVtIGludGVydmFsIHdpdGhpbiB3aGljaCB0aGUgZG9jdW1lbnQgd2lsbCBiZSBjaGVja2VkIGZvclxuICogaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5USFJPVFRMRV9USU1FT1VUID0gMTAwO1xuXG5cbi8qKlxuICogVGhlIGZyZXF1ZW5jeSBpbiB3aGljaCB0aGUgcG9seWZpbGwgcG9sbHMgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogdGhpcyBjYW4gYmUgdXBkYXRlZCBvbiBhIHBlciBpbnN0YW5jZSBiYXNpcyBhbmQgbXVzdCBiZSBzZXQgcHJpb3IgdG9cbiAqIGNhbGxpbmcgYG9ic2VydmVgIG9uIHRoZSBmaXJzdCB0YXJnZXQuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5QT0xMX0lOVEVSVkFMID0gbnVsbDtcblxuXG4vKipcbiAqIFN0YXJ0cyBvYnNlcnZpbmcgYSB0YXJnZXQgZWxlbWVudCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgYmFzZWQgb25cbiAqIHRoZSB0aHJlc2hvbGRzIHZhbHVlcy5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSBET00gZWxlbWVudCB0byBvYnNlcnZlLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUub2JzZXJ2ZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICAvLyBJZiB0aGUgdGFyZ2V0IGlzIGFscmVhZHkgYmVpbmcgb2JzZXJ2ZWQsIGRvIG5vdGhpbmcuXG4gIGlmICh0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuc29tZShmdW5jdGlvbihpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0uZWxlbWVudCA9PSB0YXJnZXQ7XG4gIH0pKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCEodGFyZ2V0ICYmIHRhcmdldC5ub2RlVHlwZSA9PSAxKSkge1xuICAgIHRocm93IG5ldyBFcnJvcigndGFyZ2V0IG11c3QgYmUgYW4gRWxlbWVudCcpO1xuICB9XG5cbiAgdGhpcy5fcmVnaXN0ZXJJbnN0YW5jZSgpO1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMucHVzaCh7ZWxlbWVudDogdGFyZ2V0LCBlbnRyeTogbnVsbH0pO1xuICB0aGlzLl9tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xufTtcblxuXG4vKipcbiAqIFN0b3BzIG9ic2VydmluZyBhIHRhcmdldCBlbGVtZW50IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSBET00gZWxlbWVudCB0byBvYnNlcnZlLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUudW5vYnNlcnZlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9XG4gICAgICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuZmlsdGVyKGZ1bmN0aW9uKGl0ZW0pIHtcblxuICAgIHJldHVybiBpdGVtLmVsZW1lbnQgIT0gdGFyZ2V0O1xuICB9KTtcbiAgaWYgKCF0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMubGVuZ3RoKSB7XG4gICAgdGhpcy5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xuICAgIHRoaXMuX3VucmVnaXN0ZXJJbnN0YW5jZSgpO1xuICB9XG59O1xuXG5cbi8qKlxuICogU3RvcHMgb2JzZXJ2aW5nIGFsbCB0YXJnZXQgZWxlbWVudHMgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuZGlzY29ubmVjdCA9IGZ1bmN0aW9uKCkge1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPSBbXTtcbiAgdGhpcy5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucygpO1xuICB0aGlzLl91bnJlZ2lzdGVySW5zdGFuY2UoKTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFueSBxdWV1ZSBlbnRyaWVzIHRoYXQgaGF2ZSBub3QgeWV0IGJlZW4gcmVwb3J0ZWQgdG8gdGhlXG4gKiBjYWxsYmFjayBhbmQgY2xlYXJzIHRoZSBxdWV1ZS4gVGhpcyBjYW4gYmUgdXNlZCBpbiBjb25qdW5jdGlvbiB3aXRoIHRoZVxuICogY2FsbGJhY2sgdG8gb2J0YWluIHRoZSBhYnNvbHV0ZSBtb3N0IHVwLXRvLWRhdGUgaW50ZXJzZWN0aW9uIGluZm9ybWF0aW9uLlxuICogQHJldHVybiB7QXJyYXl9IFRoZSBjdXJyZW50bHkgcXVldWVkIGVudHJpZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS50YWtlUmVjb3JkcyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcmVjb3JkcyA9IHRoaXMuX3F1ZXVlZEVudHJpZXMuc2xpY2UoKTtcbiAgdGhpcy5fcXVldWVkRW50cmllcyA9IFtdO1xuICByZXR1cm4gcmVjb3Jkcztcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIHRoZSB0aHJlc2hvbGQgdmFsdWUgZnJvbSB0aGUgdXNlciBjb25maWd1cmF0aW9uIG9iamVjdCBhbmRcbiAqIHJldHVybnMgYSBzb3J0ZWQgYXJyYXkgb2YgdW5pcXVlIHRocmVzaG9sZCB2YWx1ZXMuIElmIGEgdmFsdWUgaXMgbm90XG4gKiBiZXR3ZWVuIDAgYW5kIDEgYW5kIGVycm9yIGlzIHRocm93bi5cbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge0FycmF5fG51bWJlcj19IG9wdF90aHJlc2hvbGQgQW4gb3B0aW9uYWwgdGhyZXNob2xkIHZhbHVlIG9yXG4gKiAgICAgYSBsaXN0IG9mIHRocmVzaG9sZCB2YWx1ZXMsIGRlZmF1bHRpbmcgdG8gWzBdLlxuICogQHJldHVybiB7QXJyYXl9IEEgc29ydGVkIGxpc3Qgb2YgdW5pcXVlIGFuZCB2YWxpZCB0aHJlc2hvbGQgdmFsdWVzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2luaXRUaHJlc2hvbGRzID0gZnVuY3Rpb24ob3B0X3RocmVzaG9sZCkge1xuICB2YXIgdGhyZXNob2xkID0gb3B0X3RocmVzaG9sZCB8fCBbMF07XG4gIGlmICghQXJyYXkuaXNBcnJheSh0aHJlc2hvbGQpKSB0aHJlc2hvbGQgPSBbdGhyZXNob2xkXTtcblxuICByZXR1cm4gdGhyZXNob2xkLnNvcnQoKS5maWx0ZXIoZnVuY3Rpb24odCwgaSwgYSkge1xuICAgIGlmICh0eXBlb2YgdCAhPSAnbnVtYmVyJyB8fCBpc05hTih0KSB8fCB0IDwgMCB8fCB0ID4gMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCd0aHJlc2hvbGQgbXVzdCBiZSBhIG51bWJlciBiZXR3ZWVuIDAgYW5kIDEgaW5jbHVzaXZlbHknKTtcbiAgICB9XG4gICAgcmV0dXJuIHQgIT09IGFbaSAtIDFdO1xuICB9KTtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIHRoZSByb290TWFyZ2luIHZhbHVlIGZyb20gdGhlIHVzZXIgY29uZmlndXJhdGlvbiBvYmplY3RcbiAqIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mIHRoZSBmb3VyIG1hcmdpbiB2YWx1ZXMgYXMgYW4gb2JqZWN0IGNvbnRhaW5pbmdcbiAqIHRoZSB2YWx1ZSBhbmQgdW5pdCBwcm9wZXJ0aWVzLiBJZiBhbnkgb2YgdGhlIHZhbHVlcyBhcmUgbm90IHByb3Blcmx5XG4gKiBmb3JtYXR0ZWQgb3IgdXNlIGEgdW5pdCBvdGhlciB0aGFuIHB4IG9yICUsIGFuZCBlcnJvciBpcyB0aHJvd24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtzdHJpbmc9fSBvcHRfcm9vdE1hcmdpbiBBbiBvcHRpb25hbCByb290TWFyZ2luIHZhbHVlLFxuICogICAgIGRlZmF1bHRpbmcgdG8gJzBweCcuXG4gKiBAcmV0dXJuIHtBcnJheTxPYmplY3Q+fSBBbiBhcnJheSBvZiBtYXJnaW4gb2JqZWN0cyB3aXRoIHRoZSBrZXlzXG4gKiAgICAgdmFsdWUgYW5kIHVuaXQuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcGFyc2VSb290TWFyZ2luID0gZnVuY3Rpb24ob3B0X3Jvb3RNYXJnaW4pIHtcbiAgdmFyIG1hcmdpblN0cmluZyA9IG9wdF9yb290TWFyZ2luIHx8ICcwcHgnO1xuICB2YXIgbWFyZ2lucyA9IG1hcmdpblN0cmluZy5zcGxpdCgvXFxzKy8pLm1hcChmdW5jdGlvbihtYXJnaW4pIHtcbiAgICB2YXIgcGFydHMgPSAvXigtP1xcZCpcXC4/XFxkKykocHh8JSkkLy5leGVjKG1hcmdpbik7XG4gICAgaWYgKCFwYXJ0cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdyb290TWFyZ2luIG11c3QgYmUgc3BlY2lmaWVkIGluIHBpeGVscyBvciBwZXJjZW50Jyk7XG4gICAgfVxuICAgIHJldHVybiB7dmFsdWU6IHBhcnNlRmxvYXQocGFydHNbMV0pLCB1bml0OiBwYXJ0c1syXX07XG4gIH0pO1xuXG4gIC8vIEhhbmRsZXMgc2hvcnRoYW5kLlxuICBtYXJnaW5zWzFdID0gbWFyZ2luc1sxXSB8fCBtYXJnaW5zWzBdO1xuICBtYXJnaW5zWzJdID0gbWFyZ2luc1syXSB8fCBtYXJnaW5zWzBdO1xuICBtYXJnaW5zWzNdID0gbWFyZ2luc1szXSB8fCBtYXJnaW5zWzFdO1xuXG4gIHJldHVybiBtYXJnaW5zO1xufTtcblxuXG4vKipcbiAqIFN0YXJ0cyBwb2xsaW5nIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBpZiB0aGUgcG9sbGluZyBpcyBub3QgYWxyZWFkeVxuICogaGFwcGVuaW5nLCBhbmQgaWYgdGhlIHBhZ2UncyB2aXNpYmlsdHkgc3RhdGUgaXMgdmlzaWJsZS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fbW9uaXRvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucykge1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zID0gdHJ1ZTtcblxuICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucygpO1xuXG4gICAgLy8gSWYgYSBwb2xsIGludGVydmFsIGlzIHNldCwgdXNlIHBvbGxpbmcgaW5zdGVhZCBvZiBsaXN0ZW5pbmcgdG9cbiAgICAvLyByZXNpemUgYW5kIHNjcm9sbCBldmVudHMgb3IgRE9NIG11dGF0aW9ucy5cbiAgICBpZiAodGhpcy5QT0xMX0lOVEVSVkFMKSB7XG4gICAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbChcbiAgICAgICAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRoaXMuUE9MTF9JTlRFUlZBTCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgYWRkRXZlbnQod2luZG93LCAncmVzaXplJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcbiAgICAgIGFkZEV2ZW50KGRvY3VtZW50LCAnc2Nyb2xsJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcblxuICAgICAgaWYgKCdNdXRhdGlvbk9ic2VydmVyJyBpbiB3aW5kb3cpIHtcbiAgICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcih0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMpO1xuICAgICAgICB0aGlzLl9kb21PYnNlcnZlci5vYnNlcnZlKGRvY3VtZW50LCB7XG4gICAgICAgICAgYXR0cmlidXRlczogdHJ1ZSxcbiAgICAgICAgICBjaGlsZExpc3Q6IHRydWUsXG4gICAgICAgICAgY2hhcmFjdGVyRGF0YTogdHJ1ZSxcbiAgICAgICAgICBzdWJ0cmVlOiB0cnVlXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFN0b3BzIHBvbGxpbmcgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucykge1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zID0gZmFsc2U7XG5cbiAgICBjbGVhckludGVydmFsKHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCk7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVydmFsID0gbnVsbDtcblxuICAgIHJlbW92ZUV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG4gICAgcmVtb3ZlRXZlbnQoZG9jdW1lbnQsICdzY3JvbGwnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuXG4gICAgaWYgKHRoaXMuX2RvbU9ic2VydmVyKSB7XG4gICAgICB0aGlzLl9kb21PYnNlcnZlci5kaXNjb25uZWN0KCk7XG4gICAgICB0aGlzLl9kb21PYnNlcnZlciA9IG51bGw7XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogU2NhbnMgZWFjaCBvYnNlcnZhdGlvbiB0YXJnZXQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGFuZCBhZGRzIHRoZW1cbiAqIHRvIHRoZSBpbnRlcm5hbCBlbnRyaWVzIHF1ZXVlLiBJZiBuZXcgZW50cmllcyBhcmUgZm91bmQsIGl0XG4gKiBzY2hlZHVsZXMgdGhlIGNhbGxiYWNrIHRvIGJlIGludm9rZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcm9vdElzSW5Eb20gPSB0aGlzLl9yb290SXNJbkRvbSgpO1xuICB2YXIgcm9vdFJlY3QgPSByb290SXNJbkRvbSA/IHRoaXMuX2dldFJvb3RSZWN0KCkgOiBnZXRFbXB0eVJlY3QoKTtcblxuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMuZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7XG4gICAgdmFyIHRhcmdldCA9IGl0ZW0uZWxlbWVudDtcbiAgICB2YXIgdGFyZ2V0UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdCh0YXJnZXQpO1xuICAgIHZhciByb290Q29udGFpbnNUYXJnZXQgPSB0aGlzLl9yb290Q29udGFpbnNUYXJnZXQodGFyZ2V0KTtcbiAgICB2YXIgb2xkRW50cnkgPSBpdGVtLmVudHJ5O1xuICAgIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gcm9vdElzSW5Eb20gJiYgcm9vdENvbnRhaW5zVGFyZ2V0ICYmXG4gICAgICAgIHRoaXMuX2NvbXB1dGVUYXJnZXRBbmRSb290SW50ZXJzZWN0aW9uKHRhcmdldCwgcm9vdFJlY3QpO1xuXG4gICAgdmFyIG5ld0VudHJ5ID0gaXRlbS5lbnRyeSA9IG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5KHtcbiAgICAgIHRpbWU6IG5vdygpLFxuICAgICAgdGFyZ2V0OiB0YXJnZXQsXG4gICAgICBib3VuZGluZ0NsaWVudFJlY3Q6IHRhcmdldFJlY3QsXG4gICAgICByb290Qm91bmRzOiByb290UmVjdCxcbiAgICAgIGludGVyc2VjdGlvblJlY3Q6IGludGVyc2VjdGlvblJlY3RcbiAgICB9KTtcblxuICAgIGlmICghb2xkRW50cnkpIHtcbiAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgfSBlbHNlIGlmIChyb290SXNJbkRvbSAmJiByb290Q29udGFpbnNUYXJnZXQpIHtcbiAgICAgIC8vIElmIHRoZSBuZXcgZW50cnkgaW50ZXJzZWN0aW9uIHJhdGlvIGhhcyBjcm9zc2VkIGFueSBvZiB0aGVcbiAgICAgIC8vIHRocmVzaG9sZHMsIGFkZCBhIG5ldyBlbnRyeS5cbiAgICAgIGlmICh0aGlzLl9oYXNDcm9zc2VkVGhyZXNob2xkKG9sZEVudHJ5LCBuZXdFbnRyeSkpIHtcbiAgICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgdGhlIHJvb3QgaXMgbm90IGluIHRoZSBET00gb3IgdGFyZ2V0IGlzIG5vdCBjb250YWluZWQgd2l0aGluXG4gICAgICAvLyByb290IGJ1dCB0aGUgcHJldmlvdXMgZW50cnkgZm9yIHRoaXMgdGFyZ2V0IGhhZCBhbiBpbnRlcnNlY3Rpb24sXG4gICAgICAvLyBhZGQgYSBuZXcgcmVjb3JkIGluZGljYXRpbmcgcmVtb3ZhbC5cbiAgICAgIGlmIChvbGRFbnRyeSAmJiBvbGRFbnRyeS5pc0ludGVyc2VjdGluZykge1xuICAgICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgICAgfVxuICAgIH1cbiAgfSwgdGhpcyk7XG5cbiAgaWYgKHRoaXMuX3F1ZXVlZEVudHJpZXMubGVuZ3RoKSB7XG4gICAgdGhpcy5fY2FsbGJhY2sodGhpcy50YWtlUmVjb3JkcygpLCB0aGlzKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYSB0YXJnZXQgYW5kIHJvb3QgcmVjdCBjb21wdXRlcyB0aGUgaW50ZXJzZWN0aW9uIGJldHdlZW4gdGhlblxuICogZm9sbG93aW5nIHRoZSBhbGdvcml0aG0gaW4gdGhlIHNwZWMuXG4gKiBUT0RPKHBoaWxpcHdhbHRvbik6IGF0IHRoaXMgdGltZSBjbGlwLXBhdGggaXMgbm90IGNvbnNpZGVyZWQuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNjYWxjdWxhdGUtaW50ZXJzZWN0aW9uLXJlY3QtYWxnb1xuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIHRhcmdldCBET00gZWxlbWVudFxuICogQHBhcmFtIHtPYmplY3R9IHJvb3RSZWN0IFRoZSBib3VuZGluZyByZWN0IG9mIHRoZSByb290IGFmdGVyIGJlaW5nXG4gKiAgICAgZXhwYW5kZWQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcmV0dXJuIHs/T2JqZWN0fSBUaGUgZmluYWwgaW50ZXJzZWN0aW9uIHJlY3Qgb2JqZWN0IG9yIHVuZGVmaW5lZCBpZiBub1xuICogICAgIGludGVyc2VjdGlvbiBpcyBmb3VuZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fY29tcHV0ZVRhcmdldEFuZFJvb3RJbnRlcnNlY3Rpb24gPVxuICAgIGZ1bmN0aW9uKHRhcmdldCwgcm9vdFJlY3QpIHtcblxuICAvLyBJZiB0aGUgZWxlbWVudCBpc24ndCBkaXNwbGF5ZWQsIGFuIGludGVyc2VjdGlvbiBjYW4ndCBoYXBwZW4uXG4gIGlmICh3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSh0YXJnZXQpLmRpc3BsYXkgPT0gJ25vbmUnKSByZXR1cm47XG5cbiAgdmFyIHRhcmdldFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGFyZ2V0KTtcbiAgdmFyIGludGVyc2VjdGlvblJlY3QgPSB0YXJnZXRSZWN0O1xuICB2YXIgcGFyZW50ID0gdGFyZ2V0LnBhcmVudE5vZGU7XG4gIHZhciBhdFJvb3QgPSBmYWxzZTtcblxuICB3aGlsZSAoIWF0Um9vdCkge1xuICAgIHZhciBwYXJlbnRSZWN0ID0gbnVsbDtcblxuICAgIC8vIElmIHdlJ3JlIGF0IHRoZSByb290IGVsZW1lbnQsIHNldCBwYXJlbnRSZWN0IHRvIHRoZSBhbHJlYWR5XG4gICAgLy8gY2FsY3VsYXRlZCByb290UmVjdC4gQW5kIHNpbmNlIDxib2R5PiBhbmQgPGh0bWw+IGNhbm5vdCBiZSBjbGlwcGVkXG4gICAgLy8gdG8gYSByZWN0IHRoYXQncyBub3QgYWxzbyB0aGUgZG9jdW1lbnQgcmVjdCwgY29uc2lkZXIgdGhlbSByb290IHRvby5cbiAgICBpZiAocGFyZW50ID09IHRoaXMucm9vdCB8fFxuICAgICAgICBwYXJlbnQgPT0gZG9jdW1lbnQuYm9keSB8fFxuICAgICAgICBwYXJlbnQgPT0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50IHx8XG4gICAgICAgIHBhcmVudC5ub2RlVHlwZSAhPSAxKSB7XG4gICAgICBhdFJvb3QgPSB0cnVlO1xuICAgICAgcGFyZW50UmVjdCA9IHJvb3RSZWN0O1xuICAgIH1cbiAgICAvLyBPdGhlcndpc2UgY2hlY2sgdG8gc2VlIGlmIHRoZSBwYXJlbnQgZWxlbWVudCBoaWRlcyBvdmVyZmxvdyxcbiAgICAvLyBhbmQgaWYgc28gdXBkYXRlIHBhcmVudFJlY3QuXG4gICAgZWxzZSB7XG4gICAgICBpZiAod2luZG93LmdldENvbXB1dGVkU3R5bGUocGFyZW50KS5vdmVyZmxvdyAhPSAndmlzaWJsZScpIHtcbiAgICAgICAgcGFyZW50UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdChwYXJlbnQpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBJZiBlaXRoZXIgb2YgdGhlIGFib3ZlIGNvbmRpdGlvbmFscyBzZXQgYSBuZXcgcGFyZW50UmVjdCxcbiAgICAvLyBjYWxjdWxhdGUgbmV3IGludGVyc2VjdGlvbiBkYXRhLlxuICAgIGlmIChwYXJlbnRSZWN0KSB7XG4gICAgICBpbnRlcnNlY3Rpb25SZWN0ID0gY29tcHV0ZVJlY3RJbnRlcnNlY3Rpb24ocGFyZW50UmVjdCwgaW50ZXJzZWN0aW9uUmVjdCk7XG5cbiAgICAgIGlmICghaW50ZXJzZWN0aW9uUmVjdCkgYnJlYWs7XG4gICAgfVxuICAgIHBhcmVudCA9IHBhcmVudC5wYXJlbnROb2RlO1xuICB9XG4gIHJldHVybiBpbnRlcnNlY3Rpb25SZWN0O1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJvb3QgcmVjdCBhZnRlciBiZWluZyBleHBhbmRlZCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJvb3QgcmVjdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fZ2V0Um9vdFJlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RSZWN0O1xuICBpZiAodGhpcy5yb290KSB7XG4gICAgcm9vdFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGhpcy5yb290KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBVc2UgPGh0bWw+Lzxib2R5PiBpbnN0ZWFkIG9mIHdpbmRvdyBzaW5jZSBzY3JvbGwgYmFycyBhZmZlY3Qgc2l6ZS5cbiAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudDtcbiAgICB2YXIgYm9keSA9IGRvY3VtZW50LmJvZHk7XG4gICAgcm9vdFJlY3QgPSB7XG4gICAgICB0b3A6IDAsXG4gICAgICBsZWZ0OiAwLFxuICAgICAgcmlnaHQ6IGh0bWwuY2xpZW50V2lkdGggfHwgYm9keS5jbGllbnRXaWR0aCxcbiAgICAgIHdpZHRoOiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICBib3R0b206IGh0bWwuY2xpZW50SGVpZ2h0IHx8IGJvZHkuY2xpZW50SGVpZ2h0LFxuICAgICAgaGVpZ2h0OiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4ocm9vdFJlY3QpO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYSByZWN0IGFuZCBleHBhbmRzIGl0IGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QgVGhlIHJlY3Qgb2JqZWN0IHRvIGV4cGFuZC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4gPSBmdW5jdGlvbihyZWN0KSB7XG4gIHZhciBtYXJnaW5zID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luLCBpKSB7XG4gICAgcmV0dXJuIG1hcmdpbi51bml0ID09ICdweCcgPyBtYXJnaW4udmFsdWUgOlxuICAgICAgICBtYXJnaW4udmFsdWUgKiAoaSAlIDIgPyByZWN0LndpZHRoIDogcmVjdC5oZWlnaHQpIC8gMTAwO1xuICB9KTtcbiAgdmFyIG5ld1JlY3QgPSB7XG4gICAgdG9wOiByZWN0LnRvcCAtIG1hcmdpbnNbMF0sXG4gICAgcmlnaHQ6IHJlY3QucmlnaHQgKyBtYXJnaW5zWzFdLFxuICAgIGJvdHRvbTogcmVjdC5ib3R0b20gKyBtYXJnaW5zWzJdLFxuICAgIGxlZnQ6IHJlY3QubGVmdCAtIG1hcmdpbnNbM11cbiAgfTtcbiAgbmV3UmVjdC53aWR0aCA9IG5ld1JlY3QucmlnaHQgLSBuZXdSZWN0LmxlZnQ7XG4gIG5ld1JlY3QuaGVpZ2h0ID0gbmV3UmVjdC5ib3R0b20gLSBuZXdSZWN0LnRvcDtcblxuICByZXR1cm4gbmV3UmVjdDtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGFuIG9sZCBhbmQgbmV3IGVudHJ5IGFuZCByZXR1cm5zIHRydWUgaWYgYXQgbGVhc3Qgb25lIG9mIHRoZVxuICogdGhyZXNob2xkIHZhbHVlcyBoYXMgYmVlbiBjcm9zc2VkLlxuICogQHBhcmFtIHs/SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gb2xkRW50cnkgVGhlIHByZXZpb3VzIGVudHJ5IGZvciBhXG4gKiAgICBwYXJ0aWN1bGFyIHRhcmdldCBlbGVtZW50IG9yIG51bGwgaWYgbm8gcHJldmlvdXMgZW50cnkgZXhpc3RzLlxuICogQHBhcmFtIHtJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5fSBuZXdFbnRyeSBUaGUgY3VycmVudCBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudC5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiBhIGFueSB0aHJlc2hvbGQgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5faGFzQ3Jvc3NlZFRocmVzaG9sZCA9XG4gICAgZnVuY3Rpb24ob2xkRW50cnksIG5ld0VudHJ5KSB7XG5cbiAgLy8gVG8gbWFrZSBjb21wYXJpbmcgZWFzaWVyLCBhbiBlbnRyeSB0aGF0IGhhcyBhIHJhdGlvIG9mIDBcbiAgLy8gYnV0IGRvZXMgbm90IGFjdHVhbGx5IGludGVyc2VjdCBpcyBnaXZlbiBhIHZhbHVlIG9mIC0xXG4gIHZhciBvbGRSYXRpbyA9IG9sZEVudHJ5ICYmIG9sZEVudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG9sZEVudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcbiAgdmFyIG5ld1JhdGlvID0gbmV3RW50cnkuaXNJbnRlcnNlY3RpbmcgP1xuICAgICAgbmV3RW50cnkuaW50ZXJzZWN0aW9uUmF0aW8gfHwgMCA6IC0xO1xuXG4gIC8vIElnbm9yZSB1bmNoYW5nZWQgcmF0aW9zXG4gIGlmIChvbGRSYXRpbyA9PT0gbmV3UmF0aW8pIHJldHVybjtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudGhyZXNob2xkcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB0aHJlc2hvbGQgPSB0aGlzLnRocmVzaG9sZHNbaV07XG5cbiAgICAvLyBSZXR1cm4gdHJ1ZSBpZiBhbiBlbnRyeSBtYXRjaGVzIGEgdGhyZXNob2xkIG9yIGlmIHRoZSBuZXcgcmF0aW9cbiAgICAvLyBhbmQgdGhlIG9sZCByYXRpbyBhcmUgb24gdGhlIG9wcG9zaXRlIHNpZGVzIG9mIGEgdGhyZXNob2xkLlxuICAgIGlmICh0aHJlc2hvbGQgPT0gb2xkUmF0aW8gfHwgdGhyZXNob2xkID09IG5ld1JhdGlvIHx8XG4gICAgICAgIHRocmVzaG9sZCA8IG9sZFJhdGlvICE9PSB0aHJlc2hvbGQgPCBuZXdSYXRpbykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIG9yIG5vdCB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSByb290IGVsZW1lbnQgaXMgYW4gZWxlbWVudCBhbmQgaXMgaW4gdGhlIERPTS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdElzSW5Eb20gPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLnJvb3QgfHwgY29udGFpbnNEZWVwKGRvY3VtZW50LCB0aGlzLnJvb3QpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgZWxlbWVudCB0byBjaGVjay5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdENvbnRhaW5zVGFyZ2V0ID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHJldHVybiBjb250YWluc0RlZXAodGhpcy5yb290IHx8IGRvY3VtZW50LCB0YXJnZXQpO1xufTtcblxuXG4vKipcbiAqIEFkZHMgdGhlIGluc3RhbmNlIHRvIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkgaWYgaXQgaXNuJ3RcbiAqIGFscmVhZHkgcHJlc2VudC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcmVnaXN0ZXJJbnN0YW5jZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAocmVnaXN0cnkuaW5kZXhPZih0aGlzKSA8IDApIHtcbiAgICByZWdpc3RyeS5wdXNoKHRoaXMpO1xuICB9XG59O1xuXG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgaW5zdGFuY2UgZnJvbSB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl91bnJlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGluZGV4ID0gcmVnaXN0cnkuaW5kZXhPZih0aGlzKTtcbiAgaWYgKGluZGV4ICE9IC0xKSByZWdpc3RyeS5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJlc3VsdCBvZiB0aGUgcGVyZm9ybWFuY2Uubm93KCkgbWV0aG9kIG9yIG51bGwgaW4gYnJvd3NlcnNcbiAqIHRoYXQgZG9uJ3Qgc3VwcG9ydCB0aGUgQVBJLlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgZWxhcHNlZCB0aW1lIHNpbmNlIHRoZSBwYWdlIHdhcyByZXF1ZXN0ZWQuXG4gKi9cbmZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIHdpbmRvdy5wZXJmb3JtYW5jZSAmJiBwZXJmb3JtYW5jZS5ub3cgJiYgcGVyZm9ybWFuY2Uubm93KCk7XG59XG5cblxuLyoqXG4gKiBUaHJvdHRsZXMgYSBmdW5jdGlvbiBhbmQgZGVsYXlzIGl0cyBleGVjdXRpb25nLCBzbyBpdCdzIG9ubHkgY2FsbGVkIGF0IG1vc3RcbiAqIG9uY2Ugd2l0aGluIGEgZ2l2ZW4gdGltZSBwZXJpb2QuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZnVuY3Rpb24gdG8gdGhyb3R0bGUuXG4gKiBAcGFyYW0ge251bWJlcn0gdGltZW91dCBUaGUgYW1vdW50IG9mIHRpbWUgdGhhdCBtdXN0IHBhc3MgYmVmb3JlIHRoZVxuICogICAgIGZ1bmN0aW9uIGNhbiBiZSBjYWxsZWQgYWdhaW4uXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn0gVGhlIHRocm90dGxlZCBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gdGhyb3R0bGUoZm4sIHRpbWVvdXQpIHtcbiAgdmFyIHRpbWVyID0gbnVsbDtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRpbWVyKSB7XG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGZuKCk7XG4gICAgICAgIHRpbWVyID0gbnVsbDtcbiAgICAgIH0sIHRpbWVvdXQpO1xuICAgIH1cbiAgfTtcbn1cblxuXG4vKipcbiAqIEFkZHMgYW4gZXZlbnQgaGFuZGxlciB0byBhIERPTSBub2RlIGVuc3VyaW5nIGNyb3NzLWJyb3dzZXIgY29tcGF0aWJpbGl0eS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gYWRkIHRoZSBldmVudCBoYW5kbGVyIHRvLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gYWRkLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBPcHRpb25hbGx5IGFkZHMgdGhlIGV2ZW4gdG8gdGhlIGNhcHR1cmVcbiAqICAgICBwaGFzZS4gTm90ZTogdGhpcyBvbmx5IHdvcmtzIGluIG1vZGVybiBicm93c2Vycy5cbiAqL1xuZnVuY3Rpb24gYWRkRXZlbnQobm9kZSwgZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSkge1xuICBpZiAodHlwZW9mIG5vZGUuYWRkRXZlbnRMaXN0ZW5lciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUgfHwgZmFsc2UpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiBub2RlLmF0dGFjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmF0dGFjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZW1vdmVzIGEgcHJldmlvdXNseSBhZGRlZCBldmVudCBoYW5kbGVyIGZyb20gYSBET00gbm9kZS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gcmVtb3ZlIHRoZSBldmVudCBoYW5kbGVyIGZyb20uXG4gKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgVGhlIGV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZXZlbnQgaGFuZGxlciB0byByZW1vdmUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9wdF91c2VDYXB0dXJlIElmIHRoZSBldmVudCBoYW5kbGVyIHdhcyBhZGRlZCB3aXRoIHRoaXNcbiAqICAgICBmbGFnIHNldCB0byB0cnVlLCBpdCBzaG91bGQgYmUgc2V0IHRvIHRydWUgaGVyZSBpbiBvcmRlciB0byByZW1vdmUgaXQuXG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5kZXRhdGNoRXZlbnQgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuZGV0YXRjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBpbnRlcnNlY3Rpb24gYmV0d2VlbiB0d28gcmVjdCBvYmplY3RzLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QxIFRoZSBmaXJzdCByZWN0LlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QyIFRoZSBzZWNvbmQgcmVjdC5cbiAqIEByZXR1cm4gez9PYmplY3R9IFRoZSBpbnRlcnNlY3Rpb24gcmVjdCBvciB1bmRlZmluZWQgaWYgbm8gaW50ZXJzZWN0aW9uXG4gKiAgICAgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVSZWN0SW50ZXJzZWN0aW9uKHJlY3QxLCByZWN0Mikge1xuICB2YXIgdG9wID0gTWF0aC5tYXgocmVjdDEudG9wLCByZWN0Mi50b3ApO1xuICB2YXIgYm90dG9tID0gTWF0aC5taW4ocmVjdDEuYm90dG9tLCByZWN0Mi5ib3R0b20pO1xuICB2YXIgbGVmdCA9IE1hdGgubWF4KHJlY3QxLmxlZnQsIHJlY3QyLmxlZnQpO1xuICB2YXIgcmlnaHQgPSBNYXRoLm1pbihyZWN0MS5yaWdodCwgcmVjdDIucmlnaHQpO1xuICB2YXIgd2lkdGggPSByaWdodCAtIGxlZnQ7XG4gIHZhciBoZWlnaHQgPSBib3R0b20gLSB0b3A7XG5cbiAgcmV0dXJuICh3aWR0aCA+PSAwICYmIGhlaWdodCA+PSAwKSAmJiB7XG4gICAgdG9wOiB0b3AsXG4gICAgYm90dG9tOiBib3R0b20sXG4gICAgbGVmdDogbGVmdCxcbiAgICByaWdodDogcmlnaHQsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIGhlaWdodDogaGVpZ2h0XG4gIH07XG59XG5cblxuLyoqXG4gKiBTaGltcyB0aGUgbmF0aXZlIGdldEJvdW5kaW5nQ2xpZW50UmVjdCBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIG9sZGVyIElFLlxuICogQHBhcmFtIHtFbGVtZW50fSBlbCBUaGUgZWxlbWVudCB3aG9zZSBib3VuZGluZyByZWN0IHRvIGdldC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIChwb3NzaWJseSBzaGltbWVkKSByZWN0IG9mIHRoZSBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRCb3VuZGluZ0NsaWVudFJlY3QoZWwpIHtcbiAgdmFyIHJlY3Q7XG5cbiAgdHJ5IHtcbiAgICByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIElnbm9yZSBXaW5kb3dzIDcgSUUxMSBcIlVuc3BlY2lmaWVkIGVycm9yXCJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vV0lDRy9JbnRlcnNlY3Rpb25PYnNlcnZlci9wdWxsLzIwNVxuICB9XG5cbiAgaWYgKCFyZWN0KSByZXR1cm4gZ2V0RW1wdHlSZWN0KCk7XG5cbiAgLy8gT2xkZXIgSUVcbiAgaWYgKCEocmVjdC53aWR0aCAmJiByZWN0LmhlaWdodCkpIHtcbiAgICByZWN0ID0ge1xuICAgICAgdG9wOiByZWN0LnRvcCxcbiAgICAgIHJpZ2h0OiByZWN0LnJpZ2h0LFxuICAgICAgYm90dG9tOiByZWN0LmJvdHRvbSxcbiAgICAgIGxlZnQ6IHJlY3QubGVmdCxcbiAgICAgIHdpZHRoOiByZWN0LnJpZ2h0IC0gcmVjdC5sZWZ0LFxuICAgICAgaGVpZ2h0OiByZWN0LmJvdHRvbSAtIHJlY3QudG9wXG4gICAgfTtcbiAgfVxuICByZXR1cm4gcmVjdDtcbn1cblxuXG4vKipcbiAqIFJldHVybnMgYW4gZW1wdHkgcmVjdCBvYmplY3QuIEFuIGVtcHR5IHJlY3QgaXMgcmV0dXJuZWQgd2hlbiBhbiBlbGVtZW50XG4gKiBpcyBub3QgaW4gdGhlIERPTS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGVtcHR5IHJlY3QuXG4gKi9cbmZ1bmN0aW9uIGdldEVtcHR5UmVjdCgpIHtcbiAgcmV0dXJuIHtcbiAgICB0b3A6IDAsXG4gICAgYm90dG9tOiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgcmlnaHQ6IDAsXG4gICAgd2lkdGg6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2tzIHRvIHNlZSBpZiBhIHBhcmVudCBlbGVtZW50IGNvbnRhaW5zIGEgY2hpbGQgZWxlbW50IChpbmNsdWRpbmcgaW5zaWRlXG4gKiBzaGFkb3cgRE9NKS5cbiAqIEBwYXJhbSB7Tm9kZX0gcGFyZW50IFRoZSBwYXJlbnQgZWxlbWVudC5cbiAqIEBwYXJhbSB7Tm9kZX0gY2hpbGQgVGhlIGNoaWxkIGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBwYXJlbnQgbm9kZSBjb250YWlucyB0aGUgY2hpbGQgbm9kZS5cbiAqL1xuZnVuY3Rpb24gY29udGFpbnNEZWVwKHBhcmVudCwgY2hpbGQpIHtcbiAgdmFyIG5vZGUgPSBjaGlsZDtcbiAgd2hpbGUgKG5vZGUpIHtcbiAgICAvLyBDaGVjayBpZiB0aGUgbm9kZSBpcyBhIHNoYWRvdyByb290LCBpZiBpdCBpcyBnZXQgdGhlIGhvc3QuXG4gICAgaWYgKG5vZGUubm9kZVR5cGUgPT0gMTEgJiYgbm9kZS5ob3N0KSB7XG4gICAgICBub2RlID0gbm9kZS5ob3N0O1xuICAgIH1cblxuICAgIGlmIChub2RlID09IHBhcmVudCkgcmV0dXJuIHRydWU7XG5cbiAgICAvLyBUcmF2ZXJzZSB1cHdhcmRzIGluIHRoZSBET00uXG4gICAgbm9kZSA9IG5vZGUucGFyZW50Tm9kZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cblxuLy8gRXhwb3NlcyB0aGUgY29uc3RydWN0b3JzIGdsb2JhbGx5Llxud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyID0gSW50ZXJzZWN0aW9uT2JzZXJ2ZXI7XG53aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSA9IEludGVyc2VjdGlvbk9ic2VydmVyRW50cnk7XG5cbn0od2luZG93LCBkb2N1bWVudCkpO1xuIiwiZXhwb3J0IGNvbnN0IGdldERldGFpbHMgPSAoZWxlbWVudCkgPT4ge1xuICByZXR1cm4ge1xuICAgIHZpZXdwb3J0V2lkdGg6IE1hdGgubWF4KGRvY3VtZW50LmJvZHkuY2xpZW50V2lkdGgsIHdpbmRvdy5pbm5lcldpZHRoKSxcbiAgICB2aWV3cG9ydEhlaWdodDogTWF0aC5tYXgoZG9jdW1lbnQuYm9keS5jbGllbnRIZWlnaHQsIHdpbmRvdy5pbm5lckhlaWdodCksXG4gICAgZWxlbWVudFdpZHRoOiBlbGVtZW50LmNsaWVudFdpZHRoLFxuICAgIGVsZW1lbnRIZWlnaHQ6IGVsZW1lbnQuY2xpZW50SGVpZ2h0LFxuICAgIGlmcmFtZUNvbnRleHQ6IGlGcmFtZUNvbnRleHQoKSxcbiAgICBmb2N1czogaXNJbkZvY3VzKClcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgaXNJbkZvY3VzID0gKCkgPT4ge1xuICBpZiAoZG9jdW1lbnQuaGlkZGVuICE9PSAndW5kZWZpbmVkJyl7XG4gICAgaWYgKGRvY3VtZW50LmhpZGRlbiA9PT0gdHJ1ZSl7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgaWYoaUZyYW1lQ29udGV4dCgpID09PSBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUUpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlmKHdpbmRvdy5kb2N1bWVudC5oYXNGb2N1cykge1xuICAgIHJldHVybiB3aW5kb3cudG9wLmRvY3VtZW50Lmhhc0ZvY3VzKCk7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuZXhwb3J0IGNvbnN0IGlGcmFtZUNvbnRleHQgPSAoKSA9PiB7XG4gIHRyeSB7XG4gICAgaWYod2luZG93LnRvcCA9PT0gd2luZG93KSB7XG4gICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5PTl9QQUdFXG4gICAgfVxuXG4gICAgbGV0IGN1cldpbiA9IHdpbmRvdywgbGV2ZWwgPSAwO1xuICAgIHdoaWxlKGN1cldpbi5wYXJlbnQgIT09IGN1cldpbiAmJiBsZXZlbCA8IDEwMDApIHtcbiAgICAgIGlmKGN1cldpbi5wYXJlbnQuZG9jdW1lbnQuZG9tYWluICE9PSBjdXJXaW4uZG9jdW1lbnQuZG9tYWluKSB7XG4gICAgICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XG4gICAgICB9XG5cbiAgICAgIGN1cldpbiA9IGN1cldpbi5wYXJlbnQ7XG4gICAgfVxuICAgIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuU0FNRV9ET01BSU5fSUZSQU1FO1xuICB9XG4gIGNhdGNoKGUpIHtcbiAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MgPSB7XG4gIE9OX1BBR0U6ICdvbiBwYWdlJyxcbiAgU0FNRV9ET01BSU5fSUZSQU1FOiAnc2FtZSBkb21haW4gaWZyYW1lJyxcbiAgQ1JPU1NfRE9NQUlOX0lGUkFNRTogJ2Nyb3NzIGRvbWFpbiBpZnJhbWUnXG59IiwiaW1wb3J0IEJhc2VUZWNobmlxdWUgZnJvbSAnLi4vTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2VUZWNobmlxdWUnO1xuXG4vLyBlbnN1cmUgdGVjaG5pcXVlIGF0bGVhc3QgaGFzIHRoZSBzYW1lIHByb3BlcnRpZXMgYW5kIG1ldGhvZHMgb2YgQWJzdHJhY3RUaW1lclxuZXhwb3J0IGNvbnN0IHZhbGlkVGVjaG5pcXVlID0gKHRlY2huaXF1ZSkgPT4ge1xuICBjb25zdCB2YWxpZCA9IFxuICAgIHR5cGVvZiB0ZWNobmlxdWUgPT09ICdmdW5jdGlvbicgJiZcbiAgICBPYmplY3RcbiAgICAgIC5nZXRPd25Qcm9wZXJ0eU5hbWVzKEJhc2VUZWNobmlxdWUpXG4gICAgICAucmVkdWNlKCAocHJvcCwgdmFsaWQpID0+IHZhbGlkICYmIHR5cGVvZiB0ZWNobmlxdWVbcHJvcF0gPT09IHR5cGVvZiBCYXNlVGVjaG5pcXVlW3Byb3BdLCB0cnVlKTtcblxuICByZXR1cm4gdmFsaWQ7XG59O1xuXG5leHBvcnQgY29uc3QgdmFsaWRFbGVtZW50ID0gKGVsZW1lbnQpID0+IHtcbiAgcmV0dXJuIGVsZW1lbnQgJiYgZWxlbWVudC50b1N0cmluZygpLmluZGV4T2YoJ0VsZW1lbnQnKSA+IC0xO1xufTtcblxuZXhwb3J0IGNvbnN0IHZhbGlkYXRlQ3JpdGVyaWEgPSAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSkgPT4ge1xuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107IFxuXG4gIGlmKHR5cGVvZiBpblZpZXdUaHJlc2hvbGQgIT09ICdudW1iZXInIHx8IGluVmlld1RocmVzaG9sZCA+IDEpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ2luVmlld1RocmVzaG9sZCBtdXN0IGJlIGEgbnVtYmVyIGVxdWFsIHRvIG9yIGxlc3MgdGhhbiAxJyk7XG4gIH1cblxuICBpZih0eXBlb2YgdGltZUluVmlldyAhPT0gJ251bWJlcicgfHwgdGltZUluVmlldyA8IDApIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ3RpbWVJblZpZXcgbXVzdCBiZSBhIG51bWJlciBncmVhdGVyIHRvIG9yIGVxdWFsIDAnKTtcbiAgfVxuXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcbn07XG5cbmV4cG9ydCBjb25zdCB2YWxpZGF0ZVN0cmF0ZWd5ID0gKHsgYXV0b3N0YXJ0LCB0ZWNobmlxdWVzLCBjcml0ZXJpYSB9KSA9PiB7XG4gIGxldCBpbnZhbGlkID0gZmFsc2UsIHJlYXNvbnMgPSBbXTtcblxuICBpZih0eXBlb2YgYXV0b3N0YXJ0ICE9PSAnYm9vbGVhbicpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ2F1dG9zdGFydCBtdXN0IGJlIGJvb2xlYW4nKTtcbiAgfVxuXG4gIGlmKCFBcnJheS5pc0FycmF5KHRlY2huaXF1ZXMpIHx8IHRlY2huaXF1ZXMubGVuZ3RoID09PSAwKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCd0ZWNobmlxdWVzIG11c3QgYmUgYW4gYXJyYXkgY29udGFpbmluZyBhdGxlYXN0IG9uIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMnKTtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlQ3JpdGVyaWEoY3JpdGVyaWEpO1xuXG4gIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKHZhbGlkYXRlZC5yZWFzb25zKTtcbiAgfVxuXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcbn07IiwiZXhwb3J0IGNvbnN0IFNUQVJUID0gJ3N0YXJ0JztcbmV4cG9ydCBjb25zdCBTVE9QID0gJ3N0b3AnO1xuZXhwb3J0IGNvbnN0IENIQU5HRSA9ICdjaGFuZ2UnO1xuZXhwb3J0IGNvbnN0IENPTVBMRVRFID0gJ2NvbXBsZXRlJztcbmV4cG9ydCBjb25zdCBVTk1FQVNVUkVBQkxFID0gJ3VubWVhc3VyZWFibGUnO1xuZXhwb3J0IGNvbnN0IElOVklFVyA9ICdpbnZpZXcnO1xuZXhwb3J0IGNvbnN0IE9VVFZJRVcgPSAnb3V0dmlldyc7ICIsImltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0IHsgZGVmYXVsdFN0cmF0ZWd5IH0gZnJvbSAnLi9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgeyB2YWxpZFRlY2huaXF1ZSwgdmFsaWRhdGVTdHJhdGVneSB9IGZyb20gJy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBFbnZpcm9ubWVudCBmcm9tICcuLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgKiBhcyBFdmVudHMgZnJvbSAnLi9FdmVudHMnO1xuXG4vLyBSZXNwb25zaWJsZSBmb3IgY29sbGVjdGluZyBtZWFzdXJlbWVudCBzdHJhdGVneSxcbi8vIHdhdGNoaW5nIGZvciBtZWFzdXJlbWVudCBjaGFuZ2VzLFxuLy8gdHJhY2tpbmcgaG93IGxvbmcgYW4gZWxlbWVudCBpcyB2aWV3YWJsZSBmb3IsXG4vLyBhbmQgbm90aWZ5aW5nIGxpc3RlbmVycyBvZiBjaGFuZ2VzXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZWFzdXJlbWVudEV4ZWN1dG9yIHtcbiAgY29uc3RydWN0b3IoZWxlbWVudCwgc3RyYXRlZ3kgPSB7fSkge1xuICAgIHRoaXMuX2xpc3RlbmVycyA9IHsgc3RhcnQ6IFtdLCBzdG9wOiBbXSwgY2hhbmdlOiBbXSwgY29tcGxldGU6IFtdLCB1bm1lYXN1cmVhYmxlOiBbXSB9O1xuICAgIHRoaXMuX2VsZW1lbnQgPSBlbGVtZW50O1xuICAgIHRoaXMuX3N0cmF0ZWd5ID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdFN0cmF0ZWd5LCBzdHJhdGVneSk7XG4gICAgdGhpcy5fY3JpdGVyaWFNZXQgPSBmYWxzZTtcblxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlU3RyYXRlZ3kodGhpcy5fc3RyYXRlZ3kpO1xuXG4gICAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICAgIHRocm93IHZhbGlkYXRlZC5yZWFzb25zO1xuICAgIH1cblxuICAgIHRoaXMuX3RlY2huaXF1ZSA9IHRoaXMuX3NlbGVjdFRlY2huaXF1ZSh0aGlzLl9zdHJhdGVneS50ZWNobmlxdWVzKTtcbiAgICBcbiAgICBpZih0aGlzLl90ZWNobmlxdWUpIHtcbiAgICAgIHRoaXMuX2FkZFN1YnNjcmlwdGlvbnModGhpcy5fdGVjaG5pcXVlKTtcbiAgICB9ICAgXG5cbiAgICBpZih0aGlzLnVubWVhc3VyZWFibGUpIHtcbiAgICAgIC8vIGZpcmUgdW5tZWFzdXJlYWJsZSBhZnRlciBjdXJyZW50IEpTIGxvb3AgY29tcGxldGVzIFxuICAgICAgLy8gc28gb3Bwb3J0dW5pdHkgaXMgZ2l2ZW4gZm9yIGNvbnN1bWVycyB0byBwcm92aWRlIHVubWVhc3VyZWFibGUgY2FsbGJhY2tcbiAgICAgIHNldFRpbWVvdXQoICgpID0+IHRoaXMuX3B1Ymxpc2goRXZlbnRzLlVOTUVBU1VSRUFCTEUsIEVudmlyb25tZW50LmdldERldGFpbHModGhpcy5fZWxlbWVudCkpLCAwKTtcbiAgICB9XG4gICAgZWxzZSBpZih0aGlzLl9zdHJhdGVneS5hdXRvc3RhcnQpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZS5zdGFydCgpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMuX3RlY2huaXF1ZS5zdGFydCgpO1xuICB9XG5cbiAgZGlzcG9zZSgpIHtcbiAgICBpZih0aGlzLl90ZWNobmlxdWUpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZS5kaXNwb3NlKCk7XG4gICAgfVxuICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgIHRoaXMudGltZXIuZGlzcG9zZSgpO1xuICAgIH1cblxuICB9XG5cbiAgLy8gRXhwb3NlIGNhbGxiYWNrIGludGVyZmFjZXMgdG8gQVBJIGNvbnN1bWVyXG4gIG9uVmlld2FibGVTdGFydChjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlNUQVJUKTtcbiAgfVxuXG4gIG9uVmlld2FibGVTdG9wKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RPUCk7XG4gIH1cblxuICBvblZpZXdhYmxlQ2hhbmdlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuQ0hBTkdFKTtcbiAgfVxuXG4gIG9uVmlld2FibGVDb21wbGV0ZShjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLkNPTVBMRVRFKTtcbiAgfVxuXG4gIG9uVW5tZWFzdXJlYWJsZShjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlVOTUVBU1VSRUFCTEUpO1xuICB9XG5cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuICF0aGlzLl90ZWNobmlxdWUgfHwgdGhpcy5fdGVjaG5pcXVlLnVubWVhc3VyZWFibGU7XG4gIH1cblxuICAvLyBzZWxlY3QgZmlyc3QgdGVjaG5pcXVlIHRoYXQgaXMgbm90IHVubWVhc3VyZWFibGVcbiAgX3NlbGVjdFRlY2huaXF1ZSh0ZWNobmlxdWVzKSB7XG4gICAgcmV0dXJuIHRlY2huaXF1ZXNcbiAgICAgICAgICAgIC5maWx0ZXIodmFsaWRUZWNobmlxdWUpXG4gICAgICAgICAgICAubWFwKHRoaXMuX2luc3RhbnRpYXRlVGVjaG5pcXVlLmJpbmQodGhpcykpXG4gICAgICAgICAgICAuZmluZCh0ZWNobmlxdWUgPT4gIXRlY2huaXF1ZS51bm1lYXN1cmVhYmxlKTtcbiAgfVxuXG4gIF9pbnN0YW50aWF0ZVRlY2huaXF1ZSh0ZWNobmlxdWUpIHtcbiAgICByZXR1cm4gbmV3IHRlY2huaXF1ZShlbGVtZW50LCB0aGlzLl9zdHJhdGVneS5jcml0ZXJpYSk7XG4gIH1cblxuICBfYWRkU3Vic2NyaXB0aW9ucyh0ZWNobmlxdWUpIHtcbiAgICBpZih0ZWNobmlxdWUpIHtcbiAgICAgIHRlY2huaXF1ZS5vbkluVmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuSU5WSUVXLCB0ZWNobmlxdWUpKTtcbiAgICAgIHRlY2huaXF1ZS5vbkNoYW5nZVZpZXcodGhpcy5fdGVjaG5pcXVlQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLkNIQU5HRSwgdGVjaG5pcXVlKSk7XG4gICAgICB0ZWNobmlxdWUub25PdXRWaWV3KHRoaXMuX3RlY2huaXF1ZUNoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5PVVRWSUVXLCB0ZWNobmlxdWUpKTtcbiAgICB9XG4gIH1cblxuICBfdGVjaG5pcXVlQ2hhbmdlKGNoYW5nZSwgdGVjaG5pcXVlKSB7XG4gICAgbGV0IGV2ZW50TmFtZTtcbiAgICBjb25zdCBkZXRhaWxzID0gdGhpcy5fYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKTtcblxuICAgIHN3aXRjaChjaGFuZ2UpIHtcbiAgICAgIGNhc2UgRXZlbnRzLklOVklFVzpcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KXtcbiAgICAgICAgICB0aGlzLnRpbWVyID0gbmV3IEluVmlld1RpbWVyKHRoaXMuX3N0cmF0ZWd5LmNyaXRlcmlhLnRpbWVJblZpZXcpO1xuICAgICAgICAgIHRoaXMudGltZXIuZWxhcHNlZCh0aGlzLl90aW1lckVsYXBzZWQuYmluZCh0aGlzLCB0ZWNobmlxdWUpKTtcbiAgICAgICAgICB0aGlzLnRpbWVyLnN0YXJ0KCk7XG4gICAgICAgICAgZXZlbnROYW1lID0gRXZlbnRzLlNUQVJUO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuQ0hBTkdFOlxuICAgICAgICBldmVudE5hbWUgPSBjaGFuZ2U7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5DT01QTEVURTpcbiAgICAgICAgaWYoIXRoaXMuX2NyaXRlcmlhTWV0KSB7XG4gICAgICAgICAgdGhpcy5fY3JpdGVyaWFNZXQgPSB0cnVlO1xuICAgICAgICAgIGV2ZW50TmFtZSA9IGNoYW5nZTtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLk9VVFZJRVc6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCkge1xuICAgICAgICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgICAgICAgIHRoaXMudGltZXIuc3RvcCgpO1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMudGltZXI7XG4gICAgICAgICAgfVxuICAgICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVE9QO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZihldmVudE5hbWUpIHtcbiAgICAgIHRoaXMuX3B1Ymxpc2goZXZlbnROYW1lLCBkZXRhaWxzKTtcbiAgICB9XG4gIH1cblxuICBfcHVibGlzaChldmVudCwgdmFsdWUpIHtcbiAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX2xpc3RlbmVyc1tldmVudF0pKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLmZvckVhY2goIGwgPT4gbCh2YWx1ZSkgKTtcbiAgICB9XG4gIH1cblxuICBfdGltZXJFbGFwc2VkKHRlY2huaXF1ZSkge1xuICAgIHRoaXMuX3RlY2huaXF1ZUNoYW5nZShFdmVudHMuQ09NUExFVEUsIHRlY2huaXF1ZSk7XG4gIH1cblxuICBfYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodGhpcy5fbGlzdGVuZXJzW2V2ZW50XSAmJiB0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMuX2xpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyAnQ2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIF9hcHBlbmRFbnZpcm9ubWVudCh0ZWNobmlxdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LmFzc2lnbihcbiAgICAgIHt9LCBcbiAgICAgIHsgXG4gICAgICAgIHBlcmNlbnRWaWV3YWJsZTogdGVjaG5pcXVlLnBlcmNlbnRWaWV3YWJsZSwgXG4gICAgICAgIHRlY2huaXF1ZTogdGVjaG5pcXVlLnRlY2huaXF1ZU5hbWUsIFxuICAgICAgICB2aWV3YWJsZTogdGVjaG5pcXVlLnZpZXdhYmxlIFxuICAgICAgfSwgXG4gICAgICBFbnZpcm9ubWVudC5nZXREZXRhaWxzKHRoaXMuX2VsZW1lbnQpIFxuICAgICk7XG4gIH1cbn0iLCJleHBvcnQgZGVmYXVsdCBjbGFzcyBCYXNlVGVjaG5pcXVlIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7XG4gICAgICBpblZpZXc6W10sXG4gICAgICBvdXRWaWV3OltdLFxuICAgICAgY2hhbmdlVmlldzpbXVxuICAgIH07XG5cbiAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IDAuMDtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgaXMgaW4gdmlldyBhY2NvcmRpbmcgdG8gc3RyYXRlZ3kgZGVmaW5lZCBieSBjb25jcmV0ZSBtZWFzdXJlbWVudCBjbGFzc1xuICBvbkluVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdpblZpZXcnKTtcbiAgfVxuXG4gIG9uQ2hhbmdlVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdjaGFuZ2VWaWV3Jyk7XG4gIH1cblxuICAvLyBlbGVtZW50IG5vIGxvbmdlciBpbiB2aWV3XG4gIG9uT3V0VmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdvdXRWaWV3Jyk7XG4gIH1cblxuICBhZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcbiAgICBpZih0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicgJiYgdGhpcy5saXN0ZW5lcnNbZXZlbnRdKSB7XG4gICAgICB0aGlzLmxpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyAnY2FsbGJhY2sgbXVzdCBiZSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBkaXNwb3NlKCkge31cblxuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXQgdmlld2FibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZ2V0IHRlY2huaXF1ZU5hbWUoKSB7XG4gICAgcmV0dXJuICdCYXNlVGVjaG5pcXVlJztcbiAgfVxufSIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhc2VUZWNobmlxdWUge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmxpc3RlbmVycyA9IHtcbiAgICAgIGluVmlldzpbXSxcbiAgICAgIG91dFZpZXc6W10sXG4gICAgICBjaGFuZ2VWaWV3OltdXG4gICAgfTtcblxuICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gMC4wO1xuICB9XG5cbiAgLy8gZWxlbWVudCBpcyBpbiB2aWV3IGFjY29yZGluZyB0byBzdHJhdGVneSBkZWZpbmVkIGJ5IGNvbmNyZXRlIG1lYXN1cmVtZW50IGNsYXNzXG4gIG9uSW5WaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2luVmlldycpO1xuICB9XG5cbiAgb25DaGFuZ2VWaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2NoYW5nZVZpZXcnKTtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgbm8gbG9uZ2VyIGluIHZpZXdcbiAgb25PdXRWaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ291dFZpZXcnKTtcbiAgfVxuXG4gIGFkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxpc3RlbmVyc1tldmVudF0pIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9XG4gICAgZWxzZSBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93ICdjYWxsYmFjayBtdXN0IGJlIGZ1bmN0aW9uJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7fVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGdldCB2aWV3YWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0Jhc2VUZWNobmlxdWUnO1xuICB9XG59IiwiaW1wb3J0IEJhc2V0ZWNobmlxdWUgZnJvbSAnLi9CYXNldGVjaG5pcXVlJztcbmltcG9ydCB7IHZhbGlkRWxlbWVudCB9IGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEludGVyc2VjdGlvbk9ic2VydmVyIGV4dGVuZHMgQmFzZXRlY2huaXF1ZSB7XG4gIGNvbnN0cnVjdG9yKGVsZW1lbnQsIGNyaXRlcmlhKSB7XG4gICAgc3VwZXIoZWxlbWVudCwgY3JpdGVyaWEpO1xuICAgIGlmKGNyaXRlcmlhICE9PSB1bmRlZmluZWQgJiYgZWxlbWVudCkge1xuICAgICAgdGhpcy5lbGVtZW50ID0gZWxlbWVudDtcbiAgICAgIHRoaXMuY3JpdGVyaWEgPSBjcml0ZXJpYTtcbiAgICAgIHRoaXMuaW5WaWV3ID0gZmFsc2U7XG4gICAgICB0aGlzLnN0YXJ0ZWQgPSBmYWxzZTtcbiAgICAgIHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzID0gWzAsMC4xLDAuMiwwLjMsMC40LDAuNSwwLjYsMC43LDAuOCwwLjksMV07XG4gICAgICBpZih0aGlzLm5vdGlmaWNhdGlvbkxldmVscy5pbmRleE9mKHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5ub3RpZmljYXRpb25MZXZlbHMucHVzaCh0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCk7XG4gICAgICB9XG4gICAgfVxuICAgIGVsc2UgaWYoIWVsZW1lbnQpIHtcbiAgICAgIHRocm93ICdlbGVtZW50IG5vdCBwcm92aWRlZCc7XG4gICAgfSBcbiAgICBlbHNlIGlmKCFjcml0ZXJpYSkge1xuICAgICAgdGhyb3cgJ2NyaXRlcmlhIG5vdCBwcm92aWRlZCc7XG4gICAgfVxuICB9XG5cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5vYnNlcnZlciA9IG5ldyB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIodGhpcy52aWV3YWJsZUNoYW5nZS5iaW5kKHRoaXMpLHsgdGhyZXNob2xkOiB0aGlzLm5vdGlmaWNhdGlvbkxldmVscyB9KTtcbiAgICB0aGlzLm9ic2VydmVyLm9ic2VydmUodGhpcy5lbGVtZW50KTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgaWYodGhpcy5vYnNlcnZlcikge1xuICAgICAgdGhpcy5vYnNlcnZlci51bm9ic2VydmUoZWxlbWVudCk7XG4gICAgICB0aGlzLm9ic2VydmVyLmRpc2Nvbm5lY3QoZWxlbWVudCk7XG4gICAgfVxuICB9XG5cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuICghd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyIHx8IHRoaXMudXNlc1BvbHlmaWxsICkgfHwgIXZhbGlkRWxlbWVudCh0aGlzLmVsZW1lbnQpO1xuICB9XG5cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLmluVmlldztcbiAgfVxuXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuICB9XG5cbiAgLy8gaW5mZXIgcG9seWZpbGwgdXNhZ2UgYnkgY2hlY2tpbmcgaWYgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgQVBJIGhhcyBUSFJPVFRMRV9USU1FT1VUIG1lbW1iZXJcbiAgZ2V0IHVzZXNQb2x5ZmlsbCgpIHtcbiAgICByZXR1cm4gdHlwZW9mIHdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuVEhST1RUTEVfVElNRU9VVCA9PT0gJ251bWJlcic7XG4gIH1cblxuICB2aWV3YWJsZUNoYW5nZShlbnRyaWVzKSB7XG4gICAgaWYoZW50cmllcyAmJiBlbnRyaWVzLmxlbmd0aCAmJiBlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucGVyY2VudFZpZXdhYmxlID0gZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbztcbiAgICAgIFxuICAgICAgaWYoZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyA8IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkICYmIHRoaXMuc3RhcnRlZCkge1xuICAgICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xuICAgICAgICB0aGlzLmxpc3RlbmVycy5vdXRWaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgICB9XG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID49IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuaW5WaWV3ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMuaW5WaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMubGlzdGVuZXJzLmNoYW5nZVZpZXcuZm9yRWFjaCggbCA9PiBsKCkgKTtcbiAgICB9XG4gIH1cblxufSIsImltcG9ydCBJbnRlcnNlY3Rpb25PYnNlcnZlciBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyJztcbmltcG9ydCBQb2x5ZmlsbCBmcm9tICdpbnRlcnNlY3Rpb24tb2JzZXJ2ZXInO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuXG4vLyBXZSBvbmx5IG5lZWQgdG8gb3ZlcnJpZGUgYSBmZXcgYXNwZWN0cyBvZiB0aGUgbmF0aXZlIGltcGxlbWVudGF0aW9uJ3MgbWVhc3VyZXJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgZXh0ZW5kcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB7XG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiBFbnZpcm9ubWVudC5pRnJhbWVDb250ZXh0KCkgPT09IEVudmlyb25tZW50LmlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRTtcbiAgfVxuXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5RmlsbCc7XG4gIH1cbn0iLCJleHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5leHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgfSBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBCYXNlVGVjaG5pcXVlIH0gZnJvbSAnLi9CYXNlVGVjaG5pcXVlJzsiLCJpbXBvcnQgKiBhcyBWYWxpZGF0b3JzIGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRlY2huaXF1ZXMgZnJvbSAnLi4vTWVhc3VyZW1lbnRUZWNobmlxdWVzLyc7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5cbmV4cG9ydCBjb25zdCBkZWZhdWx0U3RyYXRlZ3kgPSB7XG4gIGF1dG9zdGFydDogdHJ1ZSxcbiAgdGVjaG5pcXVlczogW01lYXN1cmVtZW50VGVjaG5pcXVlcy5JbnRlcnNlY3Rpb25PYnNlcnZlciwgTWVhc3VyZW1lbnRUZWNobmlxdWVzLkludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGxdLFxuICBjcml0ZXJpYTogVmlld2FiaWxpdHlDcml0ZXJpYS5NUkNfVklERU9cbn07XG5cbmV4cG9ydCBjb25zdCBTdHJhdGVneUZhY3RvcnkgPSAoYXV0b3N0YXJ0ID0gZGVmYXVsdFN0cmF0ZWd5LmF1dG9zdGFydCwgdGVjaG5pcXVlcyA9IGRlZmF1bHRTdHJhdGVneS50ZWNobmlxdWVzLCBjcml0ZXJpYSA9IGRlZmF1bHRTdHJhdGVneS5jcml0ZXJpYSkgPT4ge1xuICBjb25zdCBzdHJhdGVneSA9IHsgYXV0b3N0YXJ0LCB0ZWNobmlxdWVzLCBjcml0ZXJpYSB9LFxuICAgICAgICB2YWxpZGF0ZWQgPSBWYWxpZGF0b3JzLnZhbGlkYXRlU3RyYXRlZ3koc3RyYXRlZ3kpOyAgXG5cbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcbiAgfVxuXG4gIHJldHVybiBzdHJhdGVneTtcbn07IiwiaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vTWVhc3VyZW1lbnQvRXZlbnRzJztcbmltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuL1RpbWluZy9JblZpZXdUaW1lcic7XG5pbXBvcnQgKiBhcyBTdHJhdGVnaWVzIGZyb20gJy4vTWVhc3VyZW1lbnQvU3RyYXRlZ2llcy8nO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgTWVhc3VyZW1lbnRFeGVjdXRvciBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3InO1xuaW1wb3J0ICogYXMgVmlld2FiaWxpdHlDcml0ZXJpYSBmcm9tICcuL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRlY2huaXF1ZXMgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvJztcblxuLyoqIENsYXNzIHJlcHJlc2VudHMgdGhlIG1haW4gZW50cnkgcG9pbnQgdG8gdGhlIE9wZW5WViBsaWJyYXJ5ICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBPcGVuVlYge1xuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIE9wZW5WViBcbiAgICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuZXhlY3V0b3JzID0gW107XG4gIH1cblxuICAvKipcbiAgICogQWxsb3dzIG1lYXN1cmVtZW50IG9mIGFuIGVsZW1lbnQgdXNpbmcgYSBzdHJhdGVneSBkZWZpbml0aW9uICBcbiAgICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSB0aGUgZWxlbWVudCB5b3UnZCBsaWtlIG1lYXN1cmUgdmlld2FiaWxpdHkgb25cbiAgICogQHBhcmFtICB7T2JqZWN0fSBzdHJhdGVneSAtIGFuIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIHN0cmF0ZWd5IHRvIHVzZSBmb3IgbWVhc3VyZW1lbnQuIFxuICAgKiBTZWUgT3BlblZWLlN0cmF0ZWdpZXMgZm9yIFN0cmF0ZWd5RmFjdG9yeSBhbmQgZGVmYXVsdFN0cmF0ZWd5IGZvciBtb3JlIGluZm9ybWF0aW9uLiBcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gLSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cm1lbnRFeGVjdXRvci4gXG4gICAqIFRoaXMgaW5zdGFuY2UgZXhwb3NlcyBldmVudCBsaXN0ZW5lcnMgb25WaWV3YWJsZVN0YXJ0LCBvblZpZXdhYmxlU3RvcCwgb25WaWV3YWJsZUNoYW5nZSwgb25WaWV3YWJsZUNvbXBsZXRlLCBhbmQgb25Vbm1lYXN1cmVhYmxlXG4gICAqIEFsc28gZXhwb3NlcyBzdGFydCBhbmQgZGlzcG9zZVxuICAgKi9cbiAgbWVhc3VyZUVsZW1lbnQoZWxlbWVudCwgc3RyYXRlZ3kpIHtcbiAgICBjb25zdCBleGVjdXRvciA9IG5ldyBNZWFzdXJlbWVudEV4ZWN1dG9yKGVsZW1lbnQsIHN0cmF0ZWd5KTtcbiAgICB0aGlzLmV4ZWN1dG9ycy5wdXNoKGV4ZWN1dG9yKTtcbiAgICByZXR1cm4gZXhlY3V0b3I7XG4gIH0gXG5cbiAgLyoqXG4gICAqIGRlc3Ryb3lzIGFsbCBtZWFzdXJlbWVudCBleGVjdXRvcnNcbiAgICogQHJldHVybiB7dW5kZWZpbmVkfVxuICAgKi9cbiAgZGlzcG9zZSgpIHtcbiAgICB0aGlzLmV4ZWN1dG9ycy5mb3JFYWNoKCBlID0+IGUuZGlzcG9zZSgpICk7XG4gIH1cbn1cblxuLyoqXG4gKiBFeHBvc2VzIGFsbCBwdWJsaWMgY2xhc3NlcyBhbmQgY29uc3RhbnRzIGF2YWlsYWJsZSBpbiB0aGUgT3BlblZWIHBhY2thZ2VcbiAqL1xuT3BlblZWLlZpZXdhYmlsaXR5Q3JpdGVyaWEgPSBWaWV3YWJpbGl0eUNyaXRlcmlhO1xuT3BlblZWLk1lYXN1cmVtZW50RXhlY3V0b3IgPSBNZWFzdXJlbWVudEV4ZWN1dG9yO1xuT3BlblZWLk1lYXN1cmVtZW50VGVjaG5pcXVlcyA9IE1lYXN1cmVtZW50VGVjaG5pcXVlcztcbk9wZW5WVi5JblZpZXdUaW1lciA9IEluVmlld1RpbWVyO1xuT3BlblZWLlN0cmF0ZWdpZXMgPSBTdHJhdGVnaWVzO1xuT3BlblZWLkV2ZW50cyA9IEV2ZW50czsiLCJleHBvcnQgY29uc3QgTVJDX1ZJREVPID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMjAwMFxufTtcblxuZXhwb3J0IGNvbnN0IE1SQ19ESVNQTEFZID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMTAwMFxufTtcblxuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldykgPT4gKHsgaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3IH0pOyIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEluVmlld1RpbWVyIHtcbiAgY29uc3RydWN0b3IoZHVyYXRpb24pIHtcbiAgICB0aGlzLmR1cmF0aW9uID0gZHVyYXRpb247ICAgICAgXG4gICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IGZhbHNlO1xuICB9XG5cbiAgdGltZXJDb21wbGV0ZSgpIHtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IHRydWU7XG4gICAgdGhpcy5saXN0ZW5lcnMuZm9yRWFjaCggbCA9PiBsKCkgKTtcbiAgfVxuXG4gIGVsYXBzZWQoY2IpIHtcbiAgICBpZih0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnB1c2goY2IpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgICB0aGlzLnRpbWVyID0gc2V0VGltZW91dCh0aGlzLnRpbWVyQ29tcGxldGUuYmluZCh0aGlzKSwgdGhpcy5kdXJhdGlvbik7XG4gIH1cblxuICBzdG9wKCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgfVxuXG4gIHBhdXNlKCkge1xuICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcbiAgfVxuXG4gIHJlc3VtZSgpIHtcbiAgICB0aGlzLnRpbWVyID0gc2V0VGltZW91dCh0aGlzLnRpbWVyQ29tcGxldGUuYmluZCh0aGlzKSwgdGhpcy5kdXJhdGlvbik7XG4gIH1cblxuICBlbmRUaW1lcigpIHtcbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lcik7XG4gICAgICB0aGlzLmxpc3RlbmVycy5sZW5ndGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbn0iXX0=
