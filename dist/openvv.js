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
  var parent = getParentNode(target);
  var atRoot = false;

  while (!atRoot) {
    var parentRect = null;
    var parentComputedStyle = parent.nodeType == 1 ?
        window.getComputedStyle(parent) : {};

    // If the parent isn't displayed, an intersection can't happen.
    if (parentComputedStyle.display == 'none') return;

    if (parent == this.root || parent == document) {
      atRoot = true;
      parentRect = rootRect;
    } else {
      // If the element has a non-visible overflow, and it's not the <body>
      // or <html> element, update the intersection rect.
      // Note: <body> and <html> cannot be clipped to a rect that's not also
      // the document rect, so no need to compute a new intersection.
      if (parent != document.body &&
          parent != document.documentElement &&
          parentComputedStyle.overflow != 'visible') {
        parentRect = getBoundingClientRect(parent);
      }
    }

    // If either of the above conditionals set a new parentRect,
    // calculate new intersection data.
    if (parentRect) {
      intersectionRect = computeRectIntersection(parentRect, intersectionRect);

      if (!intersectionRect) break;
    }
    parent = getParentNode(parent);
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
    if (node == parent) return true;

    node = getParentNode(node);
  }
  return false;
}


/**
 * Gets the parent node of an element or its host element if the parent node
 * is a shadow root.
 * @param {Node} node The node whose parent to get.
 * @return {Node|null} The parent node or null if no parent exists.
 */
function getParentNode(node) {
  var parent = node.parentNode;

  if (parent && parent.nodeType == 11 && parent.host) {
    // If the parent is a shadow root, return the host element.
    return parent.host;
  }
  return parent;
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
var getDetails = exports.getDetails = function getDetails() {
  var element = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

  return {
    viewportWidth: Math.max(document.body.clientWidth, window.innerWidth) || -1,
    viewportHeight: Math.max(document.body.clientHeight, window.innerHeight) || -1,
    elementWidth: element.clientWidth || -1,
    elementHeight: element.clientHeight || -1,
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
/**
 * Events module
 * @module Measurement/Events
 * represents Event constants
 */

/** represents that element is in view and measurement has started */
var START = exports.START = 'start';
/** represents a viewable measurement stop. This occurs when measurement has previously started, but the element has gone out of view */
var STOP = exports.STOP = 'stop';
/** represents a viewable change event. Either measurement has started, stopped, or the element's in view amount (viewable percentage) has changed */
var CHANGE = exports.CHANGE = 'change';
/** represents that viewability measurement has completed. the element has been in view for the duration specified in the measurement criteria */
var COMPLETE = exports.COMPLETE = 'complete';
/** represents that no compatible techniques have been found to measure viewability with */
var UNMEASUREABLE = exports.UNMEASUREABLE = 'unmeasureable';
/** internal representation of the viewable state of the element as in view */
var INVIEW = exports.INVIEW = 'inview';
/** internal representation of the viewable state of the element as out of view */
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

/**
 * Class representing a measurement executor
 */
var MeasurementExecutor = function () {
  /**
   * Create a new instance of a MeasurementExecutor
   * @param {HTMLElement} element - a HTML element to measure
   * @param {Object} strategy - a strategy object defining the measurement techniques and what criteria constitute a viewable state.
   * See OpenVV.Strategies DEFAULT_STRATEGY and StrategyFactory for more details on required params
   */
  function MeasurementExecutor(element) {
    var _this = this;

    var strategy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

    _classCallCheck(this, MeasurementExecutor);

    /** @private {Object} event listener arrays */
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    /** @private {HTMLElement} HTML element to measure */
    this._element = element;
    /** @private {Object} measurement strategy */
    this._strategy = _extends({}, _Strategies.DEFAULT_STRATEGY, strategy);
    /** @private {Boolean} tracks whether viewability criteria has been met */
    this._criteriaMet = false;

    var validated = (0, _Validators.validateStrategy)(this._strategy);

    if (validated.invalid) {
      throw validated.reasons;
    }

    /** @private {BaseTechnique} technique to measure viewability with */
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

  /** 
   * starts viewability measurment using the selected technique
   * @public
   */


  _createClass(MeasurementExecutor, [{
    key: 'start',
    value: function start() {
      this._technique.start();
    }

    /**
     * dispose the measurment technique and any timers
     * @public
     */

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

    /**
     * Handle viewability tracking start
     * @public
     * @param  {Function~viewableCallback} callback - is called when viewability starts tracking
     * @return {MeasurmentExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableStart',
    value: function onViewableStart(callback) {
      return this._addCallback(callback, Events.START);
    }

    /**
     * Handle viewability tracking stop.
     * @public
     * @param {Function~viewableCallback} callback - is called when viewability has previously started, but element is now out of view
     * @return {MeasurementExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableStop',
    value: function onViewableStop(callback) {
      return this._addCallback(callback, Events.STOP);
    }

    /**
     * Handle viewability change.
     * @public
     * @param  {Function~viewableCallback} callback - called when the viewable percentage of the element has changed
     * @return {MeasurementExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableChange',
    value: function onViewableChange(callback) {
      return this._addCallback(callback, Events.CHANGE);
    }

    /**
     * Handle viewability complete.
     * @public
     * @param  {Function~viewableCallback} callback - called when element has been in view for the duration specified in the measurement strategy config
     * @return {MeasurementExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onViewableComplete',
    value: function onViewableComplete(callback) {
      this._addCallback(callback, Events.COMPLETE);
      // if viewablity criteria already met, fire callback immediately
      if (this.criteriaMet) {
        this._techniqueChange(Events.COMPLETE, this._technique);
      }
      return this;
    }

    /**
     * Handle unmeasureable event
     * @public
     * @param  {Function~viewableCallback} callback - called when no suitable measurement techniques are available from the techniques provided
     * @return {MeasurementExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

  }, {
    key: 'onUnmeasureable',
    value: function onUnmeasureable(callback) {
      this._addCallback(callback, Events.UNMEASUREABLE);
      // if executor is already unmeasureable, fire callback immediately
      if (this.unmeasureable) {
        this._techniqueChange(Events.UNMEASUREABLE);
      }
      return this;
    }

    /**
    * @callback Function~viewableCallback
    * @param {Object} details - environment and measurement details of viewable event
    * @return {MeasurmentExecutor} - returns instance of MeasurementExecutor associated with this callback
    */

    /**
     * @return {Boolean} - whether MeasurementExecutor instance is capable of measuring viewability
     */

  }, {
    key: '_selectTechnique',


    /**
     * Instantiates and filters list of available measurement technqiues to the first unmeasureable technique
     * @private
     * @param  {Array} - list of techniques available to measure viewability with
     * @return {BaseTechnique} - selected technique
     */
    value: function _selectTechnique(techniques) {
      return techniques.filter(_Validators.validTechnique).map(this._instantiateTechnique.bind(this)).find(function (technique) {
        return !technique.unmeasureable;
      });
    }

    /**
     * creates instance of technique
     * @private
     * @param  {Function} - technique constructor
     * @return {BaseTechnique} - instance of technique provided
     */

  }, {
    key: '_instantiateTechnique',
    value: function _instantiateTechnique(technique) {
      return new technique(element, this._strategy.criteria);
    }

    /**
     * adds event listeners to technique 
     * @private
     * @param {BaseTechnique} - technique to add event listeners to
     */

  }, {
    key: '_addSubscriptions',
    value: function _addSubscriptions(technique) {
      if (technique) {
        technique.onInView(this._techniqueChange.bind(this, Events.INVIEW, technique));
        technique.onChangeView(this._techniqueChange.bind(this, Events.CHANGE, technique));
        technique.onOutView(this._techniqueChange.bind(this, Events.OUTVIEW, technique));
      }
    }

    /**
     * handles viewable change events from a measurement technique
     * @private
     * @param  {String} - change type. See Measurement/Events module for list of changes
     * @param  {Object} - technique that reported change. May be undefined in case of unmeasureable event
     */

  }, {
    key: '_techniqueChange',
    value: function _techniqueChange(change) {
      var technique = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

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

        case Events.UNMEASUREABLE:
          eventName = Events.UNMEASUREABLE;
      }

      if (eventName) {
        this._publish(eventName, details);
      }
    }

    /**
     * publishes events to available listeners
     * @private
     * @param  {String} - event name
     * @param  {*} - value to call callback with
     */

  }, {
    key: '_publish',
    value: function _publish(event, value) {
      if (Array.isArray(this._listeners[event])) {
        this._listeners[event].forEach(function (l) {
          return l(value);
        });
      }
    }

    /**
     * callback for timer elapsed 
     * @private
     * @param  {BaseTechnique} - technique used to perform measurement
     */

  }, {
    key: '_timerElapsed',
    value: function _timerElapsed(technique) {
      this._techniqueChange(Events.COMPLETE, technique);
    }

    /**
     * Associates callback function with event 
     * @private
     * @param {Function} - callback function to associate with event
     * @param {String} event - event to associate callback function with
     * @return {MeasurementExecutor} - returns instance of MeasurementExecutor associated with this callback
     */

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

    /**
     * Combines environment details with measurement technique details
     * @private
     * @param  {BaseTechnique} - technique to get measurement details from 
     * @return {Object} - Environment details and measurement details combined
     */

  }, {
    key: '_appendEnvironment',
    value: function _appendEnvironment(technique) {
      return _extends({}, {
        percentViewable: technique.percentViewable || -1,
        technique: technique.techniqueName || -1,
        viewable: technique.viewable || -1
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

/**
 * Class representing basic functionality of a Measurement Technique
 * Some of it's members are intended to be overriden by inheritting class
 */
var BaseTechnique = function () {
  /**
   * @constructor
   * @return {BaseTechnique} - instance of BaseTechnique
   */
  function BaseTechnique() {
    _classCallCheck(this, BaseTechnique);

    this.listeners = {
      inView: [],
      outView: [],
      changeView: []
    };

    this.percentViewable = 0.0;
  }

  /**
   * Defines callback to call when technique determines element is in view
   * @param  {Function~changeCallback} - callback to call when element is in view
   * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */


  _createClass(BaseTechnique, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }

    /**
     * Defines callback to call when technique determines element viewability has changed
     * @param  {Function~changeCallback} - callback to call when element's viewability has changed
     * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'changeView');
    }

    /**
     * Defines callback to call when technique determines element is no longer in view
     * @param  {Function~changeCallback} - callback to call when element is no longer in view
     * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onOutView',
    value: function onOutView(cb) {
      return this.addCallback(cb, 'outView');
    }

    /**
     * @callback Function~changeCallback
     */

    /**
     * Associate callback with named event
     * @param {Function} callback - callback to call when event occurs
     * @param {String} event - name of event to associate with callback
     */

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

    /**
     * empty dispose member. should be implemented by inheritting class
     */

  }, {
    key: 'dispose',
    value: function dispose() {}

    /**
     * @return {Boolean} - defines whether the technique is capable of measuring in the current environment
     */

  }, {
    key: 'unmeasureable',
    get: function get() {
      return false;
    }

    /**
     * @return {Boolean} - defines whether the technique has determined that the measured element is in view
     */

  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }

    /**
     * @return {String} - name of the measurement technique
     */

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

/**
 * Class representing basic functionality of a Measurement Technique
 * Some of it's members are intended to be overriden by inheritting class
 */
var BaseTechnique = function () {
  /**
   * @constructor
   * @return {BaseTechnique} - instance of BaseTechnique
   */
  function BaseTechnique() {
    _classCallCheck(this, BaseTechnique);

    this.listeners = {
      inView: [],
      outView: [],
      changeView: []
    };

    this.percentViewable = 0.0;
  }

  /**
   * Defines callback to call when technique determines element is in view
   * @param  {Function~changeCallback} - callback to call when element is in view
   * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
   */


  _createClass(BaseTechnique, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }

    /**
     * Defines callback to call when technique determines element viewability has changed
     * @param  {Function~changeCallback} - callback to call when element's viewability has changed
     * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'changeView');
    }

    /**
     * Defines callback to call when technique determines element is no longer in view
     * @param  {Function~changeCallback} - callback to call when element is no longer in view
     * @return {BaseTechnique} - instance of BaseTechnique associated with callback. Can be used to chain callback definitions.
     */

  }, {
    key: 'onOutView',
    value: function onOutView(cb) {
      return this.addCallback(cb, 'outView');
    }

    /**
     * @callback Function~changeCallback
     */

    /**
     * Associate callback with named event
     * @param {Function} callback - callback to call when event occurs
     * @param {String} event - name of event to associate with callback
     */

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

    /**
     * empty dispose member. should be implemented by inheritting class
     */

  }, {
    key: 'dispose',
    value: function dispose() {}

    /**
     * @return {Boolean} - defines whether the technique is capable of measuring in the current environment
     */

  }, {
    key: 'unmeasureable',
    get: function get() {
      return false;
    }

    /**
     * @return {Boolean} - defines whether the technique has determined that the measured element is in view
     */

  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }

    /**
     * @return {String} - name of the measurement technique
     */

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
exports.StrategyFactory = exports.DEFAULT_STRATEGY = undefined;

var _Validators = require('../../Helpers/Validators');

var Validators = _interopRequireWildcard(_Validators);

var _MeasurementTechniques = require('../MeasurementTechniques/');

var MeasurementTechniques = _interopRequireWildcard(_MeasurementTechniques);

var _ViewabilityCriteria = require('../../Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

/**
 * represents default measurement strategy. Defines autostart, techniques, and measurement criteria
 * @type {Object}
 */
var DEFAULT_STRATEGY = exports.DEFAULT_STRATEGY = {
  autostart: true,
  techniques: [MeasurementTechniques.IntersectionObserver, MeasurementTechniques.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

/**
 * Create strategy object using the provided values
 * @param  {Boolean} autostart - whether measurement should start immediately
 * @param  {Array} techniques - list of techniques to use for measurement. First non-unmeasureable technique will be used
 * @param  {Object} criteria - criteria object. See Options/ViewabilityCriteria for pre-defined criteria and criteria factory
 * @return {Object} - object containing appropriately named properties to be used as measurement strategy
 */
/**
 * Strategies module
 * @module Measurement/Strategies
 * represents constants and factories related to measurement strategies 
 */

var StrategyFactory = exports.StrategyFactory = function StrategyFactory() {
  var autostart = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : DEFAULT_STRATEGY.autostart;
  var techniques = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : DEFAULT_STRATEGY.techniques;
  var criteria = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : DEFAULT_STRATEGY.criteria;

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
   * See OpenVV.Strategies for StrategyFactory and DEFAULT_STRATEGY for more information. 
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
/**
 * Viewability Criteria module
 * @module Options/ViewabilityCriteria
 * represents constants and factories related to measurement criteria 
 */

/**
 * Represents criteria for MRC viewable video impression
 * @type {Object}
 */
var MRC_VIDEO = exports.MRC_VIDEO = {
  inViewThreshold: 0.5,
  timeInView: 2000
};

/**
 * Represents criteria for MRC viewable display impression
 * @type {Object}
 */
var MRC_DISPLAY = exports.MRC_DISPLAY = {
  inViewThreshold: 0.5,
  timeInView: 1000
};

/**
 * Creates custom criteria object using the threshold and duration provided 
 * @param  {Number} - amount element must be in view before it is considered in view
 * @param  {Number} - how long element must be in view before it is considered viewable
 * @return {Object} - object containing appropriately named properties to be used as viewability criteria 
 */
var customCriteria = exports.customCriteria = function customCriteria() {
  var inViewThreshold = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0.5;
  var timeInView = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 2000;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyYy9FbnZpcm9ubWVudC9FbnZpcm9ubWVudC5qcyIsInNyYy9IZWxwZXJzL1ZhbGlkYXRvcnMuanMiLCJzcmMvTWVhc3VyZW1lbnQvRXZlbnRzLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3IuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2VUZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2V0ZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0ludGVyc2VjdGlvbk9ic2VydmVyLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9pbmRleC5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL09wZW5WVi5qcyIsInNyYy9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEuanMiLCJzcmMvVGltaW5nL0luVmlld1RpbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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LFNBQUwsR0FBaUIsSUFBakI7QUFDQSxXQUFLLFNBQUwsQ0FBZSxPQUFmLENBQXdCO0FBQUEsZUFBSyxHQUFMO0FBQUEsT0FBeEI7QUFDRDs7OzRCQUVPLEUsRUFBSTtBQUNWLFVBQUcsT0FBTyxFQUFQLEtBQWMsVUFBakIsRUFBNkI7QUFDM0IsYUFBSyxTQUFMLENBQWUsSUFBZixDQUFvQixFQUFwQjtBQUNEO0FBQ0Y7Ozs0QkFFTztBQUNOLFdBQUssUUFBTDtBQUNBLFdBQUssS0FBTCxHQUFhLFdBQVcsS0FBSyxhQUFMLENBQW1CLElBQW5CLENBQXdCLElBQXhCLENBQVgsRUFBMEMsS0FBSyxRQUEvQyxDQUFiO0FBQ0Q7OzsyQkFFTTtBQUNMLFdBQUssUUFBTDtBQUNEOzs7NEJBRU87QUFDTixtQkFBYSxLQUFLLEtBQWxCO0FBQ0Q7Ozs2QkFFUTtBQUNQLFdBQUssS0FBTCxHQUFhLFdBQVcsS0FBSyxhQUFMLENBQW1CLElBQW5CLENBQXdCLElBQXhCLENBQVgsRUFBMEMsS0FBSyxRQUEvQyxDQUFiO0FBQ0Q7OzsrQkFFVTtBQUNULFVBQUcsS0FBSyxLQUFSLEVBQWU7QUFDYixxQkFBYSxLQUFLLEtBQWxCO0FBQ0EsYUFBSyxTQUFMLENBQWUsTUFBZixHQUF3QixDQUF4QjtBQUNEO0FBQ0Y7Ozs4QkFFUztBQUNSLFdBQUssUUFBTDtBQUNEOzs7Ozs7a0JBNUNrQixXIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogQ29weXJpZ2h0IDIwMTYgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuKGZ1bmN0aW9uKHdpbmRvdywgZG9jdW1lbnQpIHtcbid1c2Ugc3RyaWN0JztcblxuXG4vLyBFeGl0cyBlYXJseSBpZiBhbGwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgYW5kIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnlcbi8vIGZlYXR1cmVzIGFyZSBuYXRpdmVseSBzdXBwb3J0ZWQuXG5pZiAoJ0ludGVyc2VjdGlvbk9ic2VydmVyJyBpbiB3aW5kb3cgJiZcbiAgICAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeScgaW4gd2luZG93ICYmXG4gICAgJ2ludGVyc2VjdGlvblJhdGlvJyBpbiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeS5wcm90b3R5cGUpIHtcbiAgcmV0dXJuO1xufVxuXG5cbi8qKlxuICogQW4gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkuIFRoaXMgcmVnaXN0cnkgZXhpc3RzIHRvIGhvbGQgYSBzdHJvbmdcbiAqIHJlZmVyZW5jZSB0byBJbnRlcnNlY3Rpb25PYnNlcnZlciBpbnN0YW5jZXMgY3VycmVudGx5IG9ic2VydmVyaW5nIGEgdGFyZ2V0XG4gKiBlbGVtZW50LiBXaXRob3V0IHRoaXMgcmVnaXN0cnksIGluc3RhbmNlcyB3aXRob3V0IGFub3RoZXIgcmVmZXJlbmNlIG1heSBiZVxuICogZ2FyYmFnZSBjb2xsZWN0ZWQuXG4gKi9cbnZhciByZWdpc3RyeSA9IFtdO1xuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgY29uc3RydWN0b3IuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNpbnRlcnNlY3Rpb24tb2JzZXJ2ZXItZW50cnlcbiAqIEBwYXJhbSB7T2JqZWN0fSBlbnRyeSBBIGRpY3Rpb25hcnkgb2YgaW5zdGFuY2UgcHJvcGVydGllcy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5KGVudHJ5KSB7XG4gIHRoaXMudGltZSA9IGVudHJ5LnRpbWU7XG4gIHRoaXMudGFyZ2V0ID0gZW50cnkudGFyZ2V0O1xuICB0aGlzLnJvb3RCb3VuZHMgPSBlbnRyeS5yb290Qm91bmRzO1xuICB0aGlzLmJvdW5kaW5nQ2xpZW50UmVjdCA9IGVudHJ5LmJvdW5kaW5nQ2xpZW50UmVjdDtcbiAgdGhpcy5pbnRlcnNlY3Rpb25SZWN0ID0gZW50cnkuaW50ZXJzZWN0aW9uUmVjdCB8fCBnZXRFbXB0eVJlY3QoKTtcbiAgdGhpcy5pc0ludGVyc2VjdGluZyA9ICEhZW50cnkuaW50ZXJzZWN0aW9uUmVjdDtcblxuICAvLyBDYWxjdWxhdGVzIHRoZSBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIHZhciB0YXJnZXRSZWN0ID0gdGhpcy5ib3VuZGluZ0NsaWVudFJlY3Q7XG4gIHZhciB0YXJnZXRBcmVhID0gdGFyZ2V0UmVjdC53aWR0aCAqIHRhcmdldFJlY3QuaGVpZ2h0O1xuICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHRoaXMuaW50ZXJzZWN0aW9uUmVjdDtcbiAgdmFyIGludGVyc2VjdGlvbkFyZWEgPSBpbnRlcnNlY3Rpb25SZWN0LndpZHRoICogaW50ZXJzZWN0aW9uUmVjdC5oZWlnaHQ7XG5cbiAgLy8gU2V0cyBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIGlmICh0YXJnZXRBcmVhKSB7XG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IGludGVyc2VjdGlvbkFyZWEgLyB0YXJnZXRBcmVhO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGFyZWEgaXMgemVybyBhbmQgaXMgaW50ZXJzZWN0aW5nLCBzZXRzIHRvIDEsIG90aGVyd2lzZSB0byAwXG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IHRoaXMuaXNJbnRlcnNlY3RpbmcgPyAxIDogMDtcbiAgfVxufVxuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIGNvbnN0cnVjdG9yLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jaW50ZXJzZWN0aW9uLW9ic2VydmVyLWludGVyZmFjZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGJlIGludm9rZWQgYWZ0ZXIgaW50ZXJzZWN0aW9uXG4gKiAgICAgY2hhbmdlcyBoYXZlIHF1ZXVlZC4gVGhlIGZ1bmN0aW9uIGlzIG5vdCBpbnZva2VkIGlmIHRoZSBxdWV1ZSBoYXNcbiAqICAgICBiZWVuIGVtcHRpZWQgYnkgY2FsbGluZyB0aGUgYHRha2VSZWNvcmRzYCBtZXRob2QuXG4gKiBAcGFyYW0ge09iamVjdD19IG9wdF9vcHRpb25zIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlcihjYWxsYmFjaywgb3B0X29wdGlvbnMpIHtcblxuICB2YXIgb3B0aW9ucyA9IG9wdF9vcHRpb25zIHx8IHt9O1xuXG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cblxuICBpZiAob3B0aW9ucy5yb290ICYmIG9wdGlvbnMucm9vdC5ub2RlVHlwZSAhPSAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyb290IG11c3QgYmUgYW4gRWxlbWVudCcpO1xuICB9XG5cbiAgLy8gQmluZHMgYW5kIHRocm90dGxlcyBgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zYC5cbiAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zID0gdGhyb3R0bGUoXG4gICAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMuYmluZCh0aGlzKSwgdGhpcy5USFJPVFRMRV9USU1FT1VUKTtcblxuICAvLyBQcml2YXRlIHByb3BlcnRpZXMuXG4gIHRoaXMuX2NhbGxiYWNrID0gY2FsbGJhY2s7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9IFtdO1xuICB0aGlzLl9xdWV1ZWRFbnRyaWVzID0gW107XG4gIHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMgPSB0aGlzLl9wYXJzZVJvb3RNYXJnaW4ob3B0aW9ucy5yb290TWFyZ2luKTtcblxuICAvLyBQdWJsaWMgcHJvcGVydGllcy5cbiAgdGhpcy50aHJlc2hvbGRzID0gdGhpcy5faW5pdFRocmVzaG9sZHMob3B0aW9ucy50aHJlc2hvbGQpO1xuICB0aGlzLnJvb3QgPSBvcHRpb25zLnJvb3QgfHwgbnVsbDtcbiAgdGhpcy5yb290TWFyZ2luID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgcmV0dXJuIG1hcmdpbi52YWx1ZSArIG1hcmdpbi51bml0O1xuICB9KS5qb2luKCcgJyk7XG59XG5cblxuLyoqXG4gKiBUaGUgbWluaW11bSBpbnRlcnZhbCB3aXRoaW4gd2hpY2ggdGhlIGRvY3VtZW50IHdpbGwgYmUgY2hlY2tlZCBmb3JcbiAqIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuVEhST1RUTEVfVElNRU9VVCA9IDEwMDtcblxuXG4vKipcbiAqIFRoZSBmcmVxdWVuY3kgaW4gd2hpY2ggdGhlIHBvbHlmaWxsIHBvbGxzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIHRoaXMgY2FuIGJlIHVwZGF0ZWQgb24gYSBwZXIgaW5zdGFuY2UgYmFzaXMgYW5kIG11c3QgYmUgc2V0IHByaW9yIHRvXG4gKiBjYWxsaW5nIGBvYnNlcnZlYCBvbiB0aGUgZmlyc3QgdGFyZ2V0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuUE9MTF9JTlRFUlZBTCA9IG51bGw7XG5cblxuLyoqXG4gKiBTdGFydHMgb2JzZXJ2aW5nIGEgdGFyZ2V0IGVsZW1lbnQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGJhc2VkIG9uXG4gKiB0aGUgdGhyZXNob2xkcyB2YWx1ZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLm9ic2VydmUgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgLy8gSWYgdGhlIHRhcmdldCBpcyBhbHJlYWR5IGJlaW5nIG9ic2VydmVkLCBkbyBub3RoaW5nLlxuICBpZiAodGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnNvbWUoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLmVsZW1lbnQgPT0gdGFyZ2V0O1xuICB9KSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghKHRhcmdldCAmJiB0YXJnZXQubm9kZVR5cGUgPT0gMSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3RhcmdldCBtdXN0IGJlIGFuIEVsZW1lbnQnKTtcbiAgfVxuXG4gIHRoaXMuX3JlZ2lzdGVySW5zdGFuY2UoKTtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnB1c2goe2VsZW1lbnQ6IHRhcmdldCwgZW50cnk6IG51bGx9KTtcbiAgdGhpcy5fbW9uaXRvckludGVyc2VjdGlvbnMoKTtcbn07XG5cblxuLyoqXG4gKiBTdG9wcyBvYnNlcnZpbmcgYSB0YXJnZXQgZWxlbWVudCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLnVub2JzZXJ2ZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPVxuICAgICAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG5cbiAgICByZXR1cm4gaXRlbS5lbGVtZW50ICE9IHRhcmdldDtcbiAgfSk7XG4gIGlmICghdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmxlbmd0aCkge1xuICAgIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgICB0aGlzLl91bnJlZ2lzdGVySW5zdGFuY2UoKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFN0b3BzIG9ic2VydmluZyBhbGwgdGFyZ2V0IGVsZW1lbnRzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLmRpc2Nvbm5lY3QgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID0gW107XG4gIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgdGhpcy5fdW5yZWdpc3Rlckluc3RhbmNlKCk7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyBhbnkgcXVldWUgZW50cmllcyB0aGF0IGhhdmUgbm90IHlldCBiZWVuIHJlcG9ydGVkIHRvIHRoZVxuICogY2FsbGJhY2sgYW5kIGNsZWFycyB0aGUgcXVldWUuIFRoaXMgY2FuIGJlIHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCB0aGVcbiAqIGNhbGxiYWNrIHRvIG9idGFpbiB0aGUgYWJzb2x1dGUgbW9zdCB1cC10by1kYXRlIGludGVyc2VjdGlvbiBpbmZvcm1hdGlvbi5cbiAqIEByZXR1cm4ge0FycmF5fSBUaGUgY3VycmVudGx5IHF1ZXVlZCBlbnRyaWVzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUudGFrZVJlY29yZHMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJlY29yZHMgPSB0aGlzLl9xdWV1ZWRFbnRyaWVzLnNsaWNlKCk7XG4gIHRoaXMuX3F1ZXVlZEVudHJpZXMgPSBbXTtcbiAgcmV0dXJuIHJlY29yZHM7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgdGhyZXNob2xkIHZhbHVlIGZyb20gdGhlIHVzZXIgY29uZmlndXJhdGlvbiBvYmplY3QgYW5kXG4gKiByZXR1cm5zIGEgc29ydGVkIGFycmF5IG9mIHVuaXF1ZSB0aHJlc2hvbGQgdmFsdWVzLiBJZiBhIHZhbHVlIGlzIG5vdFxuICogYmV0d2VlbiAwIGFuZCAxIGFuZCBlcnJvciBpcyB0aHJvd24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheXxudW1iZXI9fSBvcHRfdGhyZXNob2xkIEFuIG9wdGlvbmFsIHRocmVzaG9sZCB2YWx1ZSBvclxuICogICAgIGEgbGlzdCBvZiB0aHJlc2hvbGQgdmFsdWVzLCBkZWZhdWx0aW5nIHRvIFswXS5cbiAqIEByZXR1cm4ge0FycmF5fSBBIHNvcnRlZCBsaXN0IG9mIHVuaXF1ZSBhbmQgdmFsaWQgdGhyZXNob2xkIHZhbHVlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9pbml0VGhyZXNob2xkcyA9IGZ1bmN0aW9uKG9wdF90aHJlc2hvbGQpIHtcbiAgdmFyIHRocmVzaG9sZCA9IG9wdF90aHJlc2hvbGQgfHwgWzBdO1xuICBpZiAoIUFycmF5LmlzQXJyYXkodGhyZXNob2xkKSkgdGhyZXNob2xkID0gW3RocmVzaG9sZF07XG5cbiAgcmV0dXJuIHRocmVzaG9sZC5zb3J0KCkuZmlsdGVyKGZ1bmN0aW9uKHQsIGksIGEpIHtcbiAgICBpZiAodHlwZW9mIHQgIT0gJ251bWJlcicgfHwgaXNOYU4odCkgfHwgdCA8IDAgfHwgdCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgYmV0d2VlbiAwIGFuZCAxIGluY2x1c2l2ZWx5Jyk7XG4gICAgfVxuICAgIHJldHVybiB0ICE9PSBhW2kgLSAxXTtcbiAgfSk7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgcm9vdE1hcmdpbiB2YWx1ZSBmcm9tIHRoZSB1c2VyIGNvbmZpZ3VyYXRpb24gb2JqZWN0XG4gKiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZiB0aGUgZm91ciBtYXJnaW4gdmFsdWVzIGFzIGFuIG9iamVjdCBjb250YWluaW5nXG4gKiB0aGUgdmFsdWUgYW5kIHVuaXQgcHJvcGVydGllcy4gSWYgYW55IG9mIHRoZSB2YWx1ZXMgYXJlIG5vdCBwcm9wZXJseVxuICogZm9ybWF0dGVkIG9yIHVzZSBhIHVuaXQgb3RoZXIgdGhhbiBweCBvciAlLCBhbmQgZXJyb3IgaXMgdGhyb3duLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7c3RyaW5nPX0gb3B0X3Jvb3RNYXJnaW4gQW4gb3B0aW9uYWwgcm9vdE1hcmdpbiB2YWx1ZSxcbiAqICAgICBkZWZhdWx0aW5nIHRvICcwcHgnLlxuICogQHJldHVybiB7QXJyYXk8T2JqZWN0Pn0gQW4gYXJyYXkgb2YgbWFyZ2luIG9iamVjdHMgd2l0aCB0aGUga2V5c1xuICogICAgIHZhbHVlIGFuZCB1bml0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3BhcnNlUm9vdE1hcmdpbiA9IGZ1bmN0aW9uKG9wdF9yb290TWFyZ2luKSB7XG4gIHZhciBtYXJnaW5TdHJpbmcgPSBvcHRfcm9vdE1hcmdpbiB8fCAnMHB4JztcbiAgdmFyIG1hcmdpbnMgPSBtYXJnaW5TdHJpbmcuc3BsaXQoL1xccysvKS5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgdmFyIHBhcnRzID0gL14oLT9cXGQqXFwuP1xcZCspKHB4fCUpJC8uZXhlYyhtYXJnaW4pO1xuICAgIGlmICghcGFydHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncm9vdE1hcmdpbiBtdXN0IGJlIHNwZWNpZmllZCBpbiBwaXhlbHMgb3IgcGVyY2VudCcpO1xuICAgIH1cbiAgICByZXR1cm4ge3ZhbHVlOiBwYXJzZUZsb2F0KHBhcnRzWzFdKSwgdW5pdDogcGFydHNbMl19O1xuICB9KTtcblxuICAvLyBIYW5kbGVzIHNob3J0aGFuZC5cbiAgbWFyZ2luc1sxXSA9IG1hcmdpbnNbMV0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1syXSA9IG1hcmdpbnNbMl0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1szXSA9IG1hcmdpbnNbM10gfHwgbWFyZ2luc1sxXTtcblxuICByZXR1cm4gbWFyZ2lucztcbn07XG5cblxuLyoqXG4gKiBTdGFydHMgcG9sbGluZyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgaWYgdGhlIHBvbGxpbmcgaXMgbm90IGFscmVhZHlcbiAqIGhhcHBlbmluZywgYW5kIGlmIHRoZSBwYWdlJ3MgdmlzaWJpbHR5IHN0YXRlIGlzIHZpc2libGUuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX21vbml0b3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IHRydWU7XG5cbiAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMoKTtcblxuICAgIC8vIElmIGEgcG9sbCBpbnRlcnZhbCBpcyBzZXQsIHVzZSBwb2xsaW5nIGluc3RlYWQgb2YgbGlzdGVuaW5nIHRvXG4gICAgLy8gcmVzaXplIGFuZCBzY3JvbGwgZXZlbnRzIG9yIERPTSBtdXRhdGlvbnMuXG4gICAgaWYgKHRoaXMuUE9MTF9JTlRFUlZBTCkge1xuICAgICAgdGhpcy5fbW9uaXRvcmluZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoXG4gICAgICAgICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0aGlzLlBPTExfSU5URVJWQUwpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIGFkZEV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG4gICAgICBhZGRFdmVudChkb2N1bWVudCwgJ3Njcm9sbCcsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG5cbiAgICAgIGlmICgnTXV0YXRpb25PYnNlcnZlcicgaW4gd2luZG93KSB7XG4gICAgICAgIHRoaXMuX2RvbU9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIodGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zKTtcbiAgICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIub2JzZXJ2ZShkb2N1bWVudCwge1xuICAgICAgICAgIGF0dHJpYnV0ZXM6IHRydWUsXG4gICAgICAgICAgY2hpbGRMaXN0OiB0cnVlLFxuICAgICAgICAgIGNoYXJhY3RlckRhdGE6IHRydWUsXG4gICAgICAgICAgc3VidHJlZTogdHJ1ZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTdG9wcyBwb2xsaW5nIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IGZhbHNlO1xuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwpO1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCA9IG51bGw7XG5cbiAgICByZW1vdmVFdmVudCh3aW5kb3csICdyZXNpemUnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuICAgIHJlbW92ZUV2ZW50KGRvY3VtZW50LCAnc2Nyb2xsJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcblxuICAgIGlmICh0aGlzLl9kb21PYnNlcnZlcikge1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIgPSBudWxsO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFNjYW5zIGVhY2ggb2JzZXJ2YXRpb24gdGFyZ2V0IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBhbmQgYWRkcyB0aGVtXG4gKiB0byB0aGUgaW50ZXJuYWwgZW50cmllcyBxdWV1ZS4gSWYgbmV3IGVudHJpZXMgYXJlIGZvdW5kLCBpdFxuICogc2NoZWR1bGVzIHRoZSBjYWxsYmFjayB0byBiZSBpbnZva2VkLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9jaGVja0ZvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RJc0luRG9tID0gdGhpcy5fcm9vdElzSW5Eb20oKTtcbiAgdmFyIHJvb3RSZWN0ID0gcm9vdElzSW5Eb20gPyB0aGlzLl9nZXRSb290UmVjdCgpIDogZ2V0RW1wdHlSZWN0KCk7XG5cbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuICAgIHZhciB0YXJnZXQgPSBpdGVtLmVsZW1lbnQ7XG4gICAgdmFyIHRhcmdldFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGFyZ2V0KTtcbiAgICB2YXIgcm9vdENvbnRhaW5zVGFyZ2V0ID0gdGhpcy5fcm9vdENvbnRhaW5zVGFyZ2V0KHRhcmdldCk7XG4gICAgdmFyIG9sZEVudHJ5ID0gaXRlbS5lbnRyeTtcbiAgICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHJvb3RJc0luRG9tICYmIHJvb3RDb250YWluc1RhcmdldCAmJlxuICAgICAgICB0aGlzLl9jb21wdXRlVGFyZ2V0QW5kUm9vdEludGVyc2VjdGlvbih0YXJnZXQsIHJvb3RSZWN0KTtcblxuICAgIHZhciBuZXdFbnRyeSA9IGl0ZW0uZW50cnkgPSBuZXcgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSh7XG4gICAgICB0aW1lOiBub3coKSxcbiAgICAgIHRhcmdldDogdGFyZ2V0LFxuICAgICAgYm91bmRpbmdDbGllbnRSZWN0OiB0YXJnZXRSZWN0LFxuICAgICAgcm9vdEJvdW5kczogcm9vdFJlY3QsXG4gICAgICBpbnRlcnNlY3Rpb25SZWN0OiBpbnRlcnNlY3Rpb25SZWN0XG4gICAgfSk7XG5cbiAgICBpZiAoIW9sZEVudHJ5KSB7XG4gICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgIH0gZWxzZSBpZiAocm9vdElzSW5Eb20gJiYgcm9vdENvbnRhaW5zVGFyZ2V0KSB7XG4gICAgICAvLyBJZiB0aGUgbmV3IGVudHJ5IGludGVyc2VjdGlvbiByYXRpbyBoYXMgY3Jvc3NlZCBhbnkgb2YgdGhlXG4gICAgICAvLyB0aHJlc2hvbGRzLCBhZGQgYSBuZXcgZW50cnkuXG4gICAgICBpZiAodGhpcy5faGFzQ3Jvc3NlZFRocmVzaG9sZChvbGRFbnRyeSwgbmV3RW50cnkpKSB7XG4gICAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHRoZSByb290IGlzIG5vdCBpbiB0aGUgRE9NIG9yIHRhcmdldCBpcyBub3QgY29udGFpbmVkIHdpdGhpblxuICAgICAgLy8gcm9vdCBidXQgdGhlIHByZXZpb3VzIGVudHJ5IGZvciB0aGlzIHRhcmdldCBoYWQgYW4gaW50ZXJzZWN0aW9uLFxuICAgICAgLy8gYWRkIGEgbmV3IHJlY29yZCBpbmRpY2F0aW5nIHJlbW92YWwuXG4gICAgICBpZiAob2xkRW50cnkgJiYgb2xkRW50cnkuaXNJbnRlcnNlY3RpbmcpIHtcbiAgICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sIHRoaXMpO1xuXG4gIGlmICh0aGlzLl9xdWV1ZWRFbnRyaWVzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrKHRoaXMudGFrZVJlY29yZHMoKSwgdGhpcyk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgdGFyZ2V0IGFuZCByb290IHJlY3QgY29tcHV0ZXMgdGhlIGludGVyc2VjdGlvbiBiZXR3ZWVuIHRoZW5cbiAqIGZvbGxvd2luZyB0aGUgYWxnb3JpdGhtIGluIHRoZSBzcGVjLlxuICogVE9ETyhwaGlsaXB3YWx0b24pOiBhdCB0aGlzIHRpbWUgY2xpcC1wYXRoIGlzIG5vdCBjb25zaWRlcmVkLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jY2FsY3VsYXRlLWludGVyc2VjdGlvbi1yZWN0LWFsZ29cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgRE9NIGVsZW1lbnRcbiAqIEBwYXJhbSB7T2JqZWN0fSByb290UmVjdCBUaGUgYm91bmRpbmcgcmVjdCBvZiB0aGUgcm9vdCBhZnRlciBiZWluZ1xuICogICAgIGV4cGFuZGVkIGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHJldHVybiB7P09iamVjdH0gVGhlIGZpbmFsIGludGVyc2VjdGlvbiByZWN0IG9iamVjdCBvciB1bmRlZmluZWQgaWYgbm9cbiAqICAgICBpbnRlcnNlY3Rpb24gaXMgZm91bmQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2NvbXB1dGVUYXJnZXRBbmRSb290SW50ZXJzZWN0aW9uID1cbiAgICBmdW5jdGlvbih0YXJnZXQsIHJvb3RSZWN0KSB7XG5cbiAgLy8gSWYgdGhlIGVsZW1lbnQgaXNuJ3QgZGlzcGxheWVkLCBhbiBpbnRlcnNlY3Rpb24gY2FuJ3QgaGFwcGVuLlxuICBpZiAod2luZG93LmdldENvbXB1dGVkU3R5bGUodGFyZ2V0KS5kaXNwbGF5ID09ICdub25lJykgcmV0dXJuO1xuXG4gIHZhciB0YXJnZXRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRhcmdldCk7XG4gIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gdGFyZ2V0UmVjdDtcbiAgdmFyIHBhcmVudCA9IGdldFBhcmVudE5vZGUodGFyZ2V0KTtcbiAgdmFyIGF0Um9vdCA9IGZhbHNlO1xuXG4gIHdoaWxlICghYXRSb290KSB7XG4gICAgdmFyIHBhcmVudFJlY3QgPSBudWxsO1xuICAgIHZhciBwYXJlbnRDb21wdXRlZFN0eWxlID0gcGFyZW50Lm5vZGVUeXBlID09IDEgP1xuICAgICAgICB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShwYXJlbnQpIDoge307XG5cbiAgICAvLyBJZiB0aGUgcGFyZW50IGlzbid0IGRpc3BsYXllZCwgYW4gaW50ZXJzZWN0aW9uIGNhbid0IGhhcHBlbi5cbiAgICBpZiAocGFyZW50Q29tcHV0ZWRTdHlsZS5kaXNwbGF5ID09ICdub25lJykgcmV0dXJuO1xuXG4gICAgaWYgKHBhcmVudCA9PSB0aGlzLnJvb3QgfHwgcGFyZW50ID09IGRvY3VtZW50KSB7XG4gICAgICBhdFJvb3QgPSB0cnVlO1xuICAgICAgcGFyZW50UmVjdCA9IHJvb3RSZWN0O1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB0aGUgZWxlbWVudCBoYXMgYSBub24tdmlzaWJsZSBvdmVyZmxvdywgYW5kIGl0J3Mgbm90IHRoZSA8Ym9keT5cbiAgICAgIC8vIG9yIDxodG1sPiBlbGVtZW50LCB1cGRhdGUgdGhlIGludGVyc2VjdGlvbiByZWN0LlxuICAgICAgLy8gTm90ZTogPGJvZHk+IGFuZCA8aHRtbD4gY2Fubm90IGJlIGNsaXBwZWQgdG8gYSByZWN0IHRoYXQncyBub3QgYWxzb1xuICAgICAgLy8gdGhlIGRvY3VtZW50IHJlY3QsIHNvIG5vIG5lZWQgdG8gY29tcHV0ZSBhIG5ldyBpbnRlcnNlY3Rpb24uXG4gICAgICBpZiAocGFyZW50ICE9IGRvY3VtZW50LmJvZHkgJiZcbiAgICAgICAgICBwYXJlbnQgIT0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50ICYmXG4gICAgICAgICAgcGFyZW50Q29tcHV0ZWRTdHlsZS5vdmVyZmxvdyAhPSAndmlzaWJsZScpIHtcbiAgICAgICAgcGFyZW50UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdChwYXJlbnQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGVpdGhlciBvZiB0aGUgYWJvdmUgY29uZGl0aW9uYWxzIHNldCBhIG5ldyBwYXJlbnRSZWN0LFxuICAgIC8vIGNhbGN1bGF0ZSBuZXcgaW50ZXJzZWN0aW9uIGRhdGEuXG4gICAgaWYgKHBhcmVudFJlY3QpIHtcbiAgICAgIGludGVyc2VjdGlvblJlY3QgPSBjb21wdXRlUmVjdEludGVyc2VjdGlvbihwYXJlbnRSZWN0LCBpbnRlcnNlY3Rpb25SZWN0KTtcblxuICAgICAgaWYgKCFpbnRlcnNlY3Rpb25SZWN0KSBicmVhaztcbiAgICB9XG4gICAgcGFyZW50ID0gZ2V0UGFyZW50Tm9kZShwYXJlbnQpO1xuICB9XG4gIHJldHVybiBpbnRlcnNlY3Rpb25SZWN0O1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJvb3QgcmVjdCBhZnRlciBiZWluZyBleHBhbmRlZCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJvb3QgcmVjdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fZ2V0Um9vdFJlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RSZWN0O1xuICBpZiAodGhpcy5yb290KSB7XG4gICAgcm9vdFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGhpcy5yb290KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBVc2UgPGh0bWw+Lzxib2R5PiBpbnN0ZWFkIG9mIHdpbmRvdyBzaW5jZSBzY3JvbGwgYmFycyBhZmZlY3Qgc2l6ZS5cbiAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudDtcbiAgICB2YXIgYm9keSA9IGRvY3VtZW50LmJvZHk7XG4gICAgcm9vdFJlY3QgPSB7XG4gICAgICB0b3A6IDAsXG4gICAgICBsZWZ0OiAwLFxuICAgICAgcmlnaHQ6IGh0bWwuY2xpZW50V2lkdGggfHwgYm9keS5jbGllbnRXaWR0aCxcbiAgICAgIHdpZHRoOiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICBib3R0b206IGh0bWwuY2xpZW50SGVpZ2h0IHx8IGJvZHkuY2xpZW50SGVpZ2h0LFxuICAgICAgaGVpZ2h0OiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4ocm9vdFJlY3QpO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYSByZWN0IGFuZCBleHBhbmRzIGl0IGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QgVGhlIHJlY3Qgb2JqZWN0IHRvIGV4cGFuZC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4gPSBmdW5jdGlvbihyZWN0KSB7XG4gIHZhciBtYXJnaW5zID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luLCBpKSB7XG4gICAgcmV0dXJuIG1hcmdpbi51bml0ID09ICdweCcgPyBtYXJnaW4udmFsdWUgOlxuICAgICAgICBtYXJnaW4udmFsdWUgKiAoaSAlIDIgPyByZWN0LndpZHRoIDogcmVjdC5oZWlnaHQpIC8gMTAwO1xuICB9KTtcbiAgdmFyIG5ld1JlY3QgPSB7XG4gICAgdG9wOiByZWN0LnRvcCAtIG1hcmdpbnNbMF0sXG4gICAgcmlnaHQ6IHJlY3QucmlnaHQgKyBtYXJnaW5zWzFdLFxuICAgIGJvdHRvbTogcmVjdC5ib3R0b20gKyBtYXJnaW5zWzJdLFxuICAgIGxlZnQ6IHJlY3QubGVmdCAtIG1hcmdpbnNbM11cbiAgfTtcbiAgbmV3UmVjdC53aWR0aCA9IG5ld1JlY3QucmlnaHQgLSBuZXdSZWN0LmxlZnQ7XG4gIG5ld1JlY3QuaGVpZ2h0ID0gbmV3UmVjdC5ib3R0b20gLSBuZXdSZWN0LnRvcDtcblxuICByZXR1cm4gbmV3UmVjdDtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGFuIG9sZCBhbmQgbmV3IGVudHJ5IGFuZCByZXR1cm5zIHRydWUgaWYgYXQgbGVhc3Qgb25lIG9mIHRoZVxuICogdGhyZXNob2xkIHZhbHVlcyBoYXMgYmVlbiBjcm9zc2VkLlxuICogQHBhcmFtIHs/SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gb2xkRW50cnkgVGhlIHByZXZpb3VzIGVudHJ5IGZvciBhXG4gKiAgICBwYXJ0aWN1bGFyIHRhcmdldCBlbGVtZW50IG9yIG51bGwgaWYgbm8gcHJldmlvdXMgZW50cnkgZXhpc3RzLlxuICogQHBhcmFtIHtJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5fSBuZXdFbnRyeSBUaGUgY3VycmVudCBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudC5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiBhIGFueSB0aHJlc2hvbGQgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5faGFzQ3Jvc3NlZFRocmVzaG9sZCA9XG4gICAgZnVuY3Rpb24ob2xkRW50cnksIG5ld0VudHJ5KSB7XG5cbiAgLy8gVG8gbWFrZSBjb21wYXJpbmcgZWFzaWVyLCBhbiBlbnRyeSB0aGF0IGhhcyBhIHJhdGlvIG9mIDBcbiAgLy8gYnV0IGRvZXMgbm90IGFjdHVhbGx5IGludGVyc2VjdCBpcyBnaXZlbiBhIHZhbHVlIG9mIC0xXG4gIHZhciBvbGRSYXRpbyA9IG9sZEVudHJ5ICYmIG9sZEVudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG9sZEVudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcbiAgdmFyIG5ld1JhdGlvID0gbmV3RW50cnkuaXNJbnRlcnNlY3RpbmcgP1xuICAgICAgbmV3RW50cnkuaW50ZXJzZWN0aW9uUmF0aW8gfHwgMCA6IC0xO1xuXG4gIC8vIElnbm9yZSB1bmNoYW5nZWQgcmF0aW9zXG4gIGlmIChvbGRSYXRpbyA9PT0gbmV3UmF0aW8pIHJldHVybjtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudGhyZXNob2xkcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB0aHJlc2hvbGQgPSB0aGlzLnRocmVzaG9sZHNbaV07XG5cbiAgICAvLyBSZXR1cm4gdHJ1ZSBpZiBhbiBlbnRyeSBtYXRjaGVzIGEgdGhyZXNob2xkIG9yIGlmIHRoZSBuZXcgcmF0aW9cbiAgICAvLyBhbmQgdGhlIG9sZCByYXRpbyBhcmUgb24gdGhlIG9wcG9zaXRlIHNpZGVzIG9mIGEgdGhyZXNob2xkLlxuICAgIGlmICh0aHJlc2hvbGQgPT0gb2xkUmF0aW8gfHwgdGhyZXNob2xkID09IG5ld1JhdGlvIHx8XG4gICAgICAgIHRocmVzaG9sZCA8IG9sZFJhdGlvICE9PSB0aHJlc2hvbGQgPCBuZXdSYXRpbykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIG9yIG5vdCB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSByb290IGVsZW1lbnQgaXMgYW4gZWxlbWVudCBhbmQgaXMgaW4gdGhlIERPTS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdElzSW5Eb20gPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLnJvb3QgfHwgY29udGFpbnNEZWVwKGRvY3VtZW50LCB0aGlzLnJvb3QpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgZWxlbWVudCB0byBjaGVjay5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdENvbnRhaW5zVGFyZ2V0ID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHJldHVybiBjb250YWluc0RlZXAodGhpcy5yb290IHx8IGRvY3VtZW50LCB0YXJnZXQpO1xufTtcblxuXG4vKipcbiAqIEFkZHMgdGhlIGluc3RhbmNlIHRvIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkgaWYgaXQgaXNuJ3RcbiAqIGFscmVhZHkgcHJlc2VudC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcmVnaXN0ZXJJbnN0YW5jZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAocmVnaXN0cnkuaW5kZXhPZih0aGlzKSA8IDApIHtcbiAgICByZWdpc3RyeS5wdXNoKHRoaXMpO1xuICB9XG59O1xuXG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgaW5zdGFuY2UgZnJvbSB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl91bnJlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGluZGV4ID0gcmVnaXN0cnkuaW5kZXhPZih0aGlzKTtcbiAgaWYgKGluZGV4ICE9IC0xKSByZWdpc3RyeS5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJlc3VsdCBvZiB0aGUgcGVyZm9ybWFuY2Uubm93KCkgbWV0aG9kIG9yIG51bGwgaW4gYnJvd3NlcnNcbiAqIHRoYXQgZG9uJ3Qgc3VwcG9ydCB0aGUgQVBJLlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgZWxhcHNlZCB0aW1lIHNpbmNlIHRoZSBwYWdlIHdhcyByZXF1ZXN0ZWQuXG4gKi9cbmZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIHdpbmRvdy5wZXJmb3JtYW5jZSAmJiBwZXJmb3JtYW5jZS5ub3cgJiYgcGVyZm9ybWFuY2Uubm93KCk7XG59XG5cblxuLyoqXG4gKiBUaHJvdHRsZXMgYSBmdW5jdGlvbiBhbmQgZGVsYXlzIGl0cyBleGVjdXRpb25nLCBzbyBpdCdzIG9ubHkgY2FsbGVkIGF0IG1vc3RcbiAqIG9uY2Ugd2l0aGluIGEgZ2l2ZW4gdGltZSBwZXJpb2QuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZnVuY3Rpb24gdG8gdGhyb3R0bGUuXG4gKiBAcGFyYW0ge251bWJlcn0gdGltZW91dCBUaGUgYW1vdW50IG9mIHRpbWUgdGhhdCBtdXN0IHBhc3MgYmVmb3JlIHRoZVxuICogICAgIGZ1bmN0aW9uIGNhbiBiZSBjYWxsZWQgYWdhaW4uXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn0gVGhlIHRocm90dGxlZCBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gdGhyb3R0bGUoZm4sIHRpbWVvdXQpIHtcbiAgdmFyIHRpbWVyID0gbnVsbDtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRpbWVyKSB7XG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGZuKCk7XG4gICAgICAgIHRpbWVyID0gbnVsbDtcbiAgICAgIH0sIHRpbWVvdXQpO1xuICAgIH1cbiAgfTtcbn1cblxuXG4vKipcbiAqIEFkZHMgYW4gZXZlbnQgaGFuZGxlciB0byBhIERPTSBub2RlIGVuc3VyaW5nIGNyb3NzLWJyb3dzZXIgY29tcGF0aWJpbGl0eS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gYWRkIHRoZSBldmVudCBoYW5kbGVyIHRvLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gYWRkLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBPcHRpb25hbGx5IGFkZHMgdGhlIGV2ZW4gdG8gdGhlIGNhcHR1cmVcbiAqICAgICBwaGFzZS4gTm90ZTogdGhpcyBvbmx5IHdvcmtzIGluIG1vZGVybiBicm93c2Vycy5cbiAqL1xuZnVuY3Rpb24gYWRkRXZlbnQobm9kZSwgZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSkge1xuICBpZiAodHlwZW9mIG5vZGUuYWRkRXZlbnRMaXN0ZW5lciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUgfHwgZmFsc2UpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiBub2RlLmF0dGFjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmF0dGFjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZW1vdmVzIGEgcHJldmlvdXNseSBhZGRlZCBldmVudCBoYW5kbGVyIGZyb20gYSBET00gbm9kZS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gcmVtb3ZlIHRoZSBldmVudCBoYW5kbGVyIGZyb20uXG4gKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgVGhlIGV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZXZlbnQgaGFuZGxlciB0byByZW1vdmUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9wdF91c2VDYXB0dXJlIElmIHRoZSBldmVudCBoYW5kbGVyIHdhcyBhZGRlZCB3aXRoIHRoaXNcbiAqICAgICBmbGFnIHNldCB0byB0cnVlLCBpdCBzaG91bGQgYmUgc2V0IHRvIHRydWUgaGVyZSBpbiBvcmRlciB0byByZW1vdmUgaXQuXG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5kZXRhdGNoRXZlbnQgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuZGV0YXRjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBpbnRlcnNlY3Rpb24gYmV0d2VlbiB0d28gcmVjdCBvYmplY3RzLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QxIFRoZSBmaXJzdCByZWN0LlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QyIFRoZSBzZWNvbmQgcmVjdC5cbiAqIEByZXR1cm4gez9PYmplY3R9IFRoZSBpbnRlcnNlY3Rpb24gcmVjdCBvciB1bmRlZmluZWQgaWYgbm8gaW50ZXJzZWN0aW9uXG4gKiAgICAgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVSZWN0SW50ZXJzZWN0aW9uKHJlY3QxLCByZWN0Mikge1xuICB2YXIgdG9wID0gTWF0aC5tYXgocmVjdDEudG9wLCByZWN0Mi50b3ApO1xuICB2YXIgYm90dG9tID0gTWF0aC5taW4ocmVjdDEuYm90dG9tLCByZWN0Mi5ib3R0b20pO1xuICB2YXIgbGVmdCA9IE1hdGgubWF4KHJlY3QxLmxlZnQsIHJlY3QyLmxlZnQpO1xuICB2YXIgcmlnaHQgPSBNYXRoLm1pbihyZWN0MS5yaWdodCwgcmVjdDIucmlnaHQpO1xuICB2YXIgd2lkdGggPSByaWdodCAtIGxlZnQ7XG4gIHZhciBoZWlnaHQgPSBib3R0b20gLSB0b3A7XG5cbiAgcmV0dXJuICh3aWR0aCA+PSAwICYmIGhlaWdodCA+PSAwKSAmJiB7XG4gICAgdG9wOiB0b3AsXG4gICAgYm90dG9tOiBib3R0b20sXG4gICAgbGVmdDogbGVmdCxcbiAgICByaWdodDogcmlnaHQsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIGhlaWdodDogaGVpZ2h0XG4gIH07XG59XG5cblxuLyoqXG4gKiBTaGltcyB0aGUgbmF0aXZlIGdldEJvdW5kaW5nQ2xpZW50UmVjdCBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIG9sZGVyIElFLlxuICogQHBhcmFtIHtFbGVtZW50fSBlbCBUaGUgZWxlbWVudCB3aG9zZSBib3VuZGluZyByZWN0IHRvIGdldC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIChwb3NzaWJseSBzaGltbWVkKSByZWN0IG9mIHRoZSBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRCb3VuZGluZ0NsaWVudFJlY3QoZWwpIHtcbiAgdmFyIHJlY3Q7XG5cbiAgdHJ5IHtcbiAgICByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIElnbm9yZSBXaW5kb3dzIDcgSUUxMSBcIlVuc3BlY2lmaWVkIGVycm9yXCJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vV0lDRy9JbnRlcnNlY3Rpb25PYnNlcnZlci9wdWxsLzIwNVxuICB9XG5cbiAgaWYgKCFyZWN0KSByZXR1cm4gZ2V0RW1wdHlSZWN0KCk7XG5cbiAgLy8gT2xkZXIgSUVcbiAgaWYgKCEocmVjdC53aWR0aCAmJiByZWN0LmhlaWdodCkpIHtcbiAgICByZWN0ID0ge1xuICAgICAgdG9wOiByZWN0LnRvcCxcbiAgICAgIHJpZ2h0OiByZWN0LnJpZ2h0LFxuICAgICAgYm90dG9tOiByZWN0LmJvdHRvbSxcbiAgICAgIGxlZnQ6IHJlY3QubGVmdCxcbiAgICAgIHdpZHRoOiByZWN0LnJpZ2h0IC0gcmVjdC5sZWZ0LFxuICAgICAgaGVpZ2h0OiByZWN0LmJvdHRvbSAtIHJlY3QudG9wXG4gICAgfTtcbiAgfVxuICByZXR1cm4gcmVjdDtcbn1cblxuXG4vKipcbiAqIFJldHVybnMgYW4gZW1wdHkgcmVjdCBvYmplY3QuIEFuIGVtcHR5IHJlY3QgaXMgcmV0dXJuZWQgd2hlbiBhbiBlbGVtZW50XG4gKiBpcyBub3QgaW4gdGhlIERPTS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGVtcHR5IHJlY3QuXG4gKi9cbmZ1bmN0aW9uIGdldEVtcHR5UmVjdCgpIHtcbiAgcmV0dXJuIHtcbiAgICB0b3A6IDAsXG4gICAgYm90dG9tOiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgcmlnaHQ6IDAsXG4gICAgd2lkdGg6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2tzIHRvIHNlZSBpZiBhIHBhcmVudCBlbGVtZW50IGNvbnRhaW5zIGEgY2hpbGQgZWxlbW50IChpbmNsdWRpbmcgaW5zaWRlXG4gKiBzaGFkb3cgRE9NKS5cbiAqIEBwYXJhbSB7Tm9kZX0gcGFyZW50IFRoZSBwYXJlbnQgZWxlbWVudC5cbiAqIEBwYXJhbSB7Tm9kZX0gY2hpbGQgVGhlIGNoaWxkIGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBwYXJlbnQgbm9kZSBjb250YWlucyB0aGUgY2hpbGQgbm9kZS5cbiAqL1xuZnVuY3Rpb24gY29udGFpbnNEZWVwKHBhcmVudCwgY2hpbGQpIHtcbiAgdmFyIG5vZGUgPSBjaGlsZDtcbiAgd2hpbGUgKG5vZGUpIHtcbiAgICBpZiAobm9kZSA9PSBwYXJlbnQpIHJldHVybiB0cnVlO1xuXG4gICAgbm9kZSA9IGdldFBhcmVudE5vZGUobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5cbi8qKlxuICogR2V0cyB0aGUgcGFyZW50IG5vZGUgb2YgYW4gZWxlbWVudCBvciBpdHMgaG9zdCBlbGVtZW50IGlmIHRoZSBwYXJlbnQgbm9kZVxuICogaXMgYSBzaGFkb3cgcm9vdC5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgbm9kZSB3aG9zZSBwYXJlbnQgdG8gZ2V0LlxuICogQHJldHVybiB7Tm9kZXxudWxsfSBUaGUgcGFyZW50IG5vZGUgb3IgbnVsbCBpZiBubyBwYXJlbnQgZXhpc3RzLlxuICovXG5mdW5jdGlvbiBnZXRQYXJlbnROb2RlKG5vZGUpIHtcbiAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcblxuICBpZiAocGFyZW50ICYmIHBhcmVudC5ub2RlVHlwZSA9PSAxMSAmJiBwYXJlbnQuaG9zdCkge1xuICAgIC8vIElmIHRoZSBwYXJlbnQgaXMgYSBzaGFkb3cgcm9vdCwgcmV0dXJuIHRoZSBob3N0IGVsZW1lbnQuXG4gICAgcmV0dXJuIHBhcmVudC5ob3N0O1xuICB9XG4gIHJldHVybiBwYXJlbnQ7XG59XG5cblxuLy8gRXhwb3NlcyB0aGUgY29uc3RydWN0b3JzIGdsb2JhbGx5Llxud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyID0gSW50ZXJzZWN0aW9uT2JzZXJ2ZXI7XG53aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSA9IEludGVyc2VjdGlvbk9ic2VydmVyRW50cnk7XG5cbn0od2luZG93LCBkb2N1bWVudCkpO1xuIiwiZXhwb3J0IGNvbnN0IGdldERldGFpbHMgPSAoZWxlbWVudCA9IHt9KSA9PiB7XG4gIHJldHVybiB7XG4gICAgdmlld3BvcnRXaWR0aDogTWF0aC5tYXgoZG9jdW1lbnQuYm9keS5jbGllbnRXaWR0aCwgd2luZG93LmlubmVyV2lkdGgpIHx8IC0xLFxuICAgIHZpZXdwb3J0SGVpZ2h0OiBNYXRoLm1heChkb2N1bWVudC5ib2R5LmNsaWVudEhlaWdodCwgd2luZG93LmlubmVySGVpZ2h0KSB8fCAtMSxcbiAgICBlbGVtZW50V2lkdGg6IGVsZW1lbnQuY2xpZW50V2lkdGggfHwgLTEsXG4gICAgZWxlbWVudEhlaWdodDogZWxlbWVudC5jbGllbnRIZWlnaHQgfHwgLTEsXG4gICAgaWZyYW1lQ29udGV4dDogaUZyYW1lQ29udGV4dCgpLFxuICAgIGZvY3VzOiBpc0luRm9jdXMoKVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBpc0luRm9jdXMgPSAoKSA9PiB7XG4gIGlmIChkb2N1bWVudC5oaWRkZW4gIT09ICd1bmRlZmluZWQnKXtcbiAgICBpZiAoZG9jdW1lbnQuaGlkZGVuID09PSB0cnVlKXtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBpZihpRnJhbWVDb250ZXh0KCkgPT09IGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaWYod2luZG93LmRvY3VtZW50Lmhhc0ZvY3VzKSB7XG4gICAgcmV0dXJuIHdpbmRvdy50b3AuZG9jdW1lbnQuaGFzRm9jdXMoKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufVxuXG5leHBvcnQgY29uc3QgaUZyYW1lQ29udGV4dCA9ICgpID0+IHtcbiAgdHJ5IHtcbiAgICBpZih3aW5kb3cudG9wID09PSB3aW5kb3cpIHtcbiAgICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLk9OX1BBR0VcbiAgICB9XG5cbiAgICBsZXQgY3VyV2luID0gd2luZG93LCBsZXZlbCA9IDA7XG4gICAgd2hpbGUoY3VyV2luLnBhcmVudCAhPT0gY3VyV2luICYmIGxldmVsIDwgMTAwMCkge1xuICAgICAgaWYoY3VyV2luLnBhcmVudC5kb2N1bWVudC5kb21haW4gIT09IGN1cldpbi5kb2N1bWVudC5kb21haW4pIHtcbiAgICAgICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRTtcbiAgICAgIH1cblxuICAgICAgY3VyV2luID0gY3VyV2luLnBhcmVudDtcbiAgICB9XG4gICAgaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5TQU1FX0RPTUFJTl9JRlJBTUU7XG4gIH1cbiAgY2F0Y2goZSkge1xuICAgIHJldHVybiBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUVcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgaUZyYW1lU2VydmluZ1NjZW5hcmlvcyA9IHtcbiAgT05fUEFHRTogJ29uIHBhZ2UnLFxuICBTQU1FX0RPTUFJTl9JRlJBTUU6ICdzYW1lIGRvbWFpbiBpZnJhbWUnLFxuICBDUk9TU19ET01BSU5fSUZSQU1FOiAnY3Jvc3MgZG9tYWluIGlmcmFtZSdcbn0iLCJpbXBvcnQgQmFzZVRlY2huaXF1ZSBmcm9tICcuLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvQmFzZVRlY2huaXF1ZSc7XG5cbi8vIGVuc3VyZSB0ZWNobmlxdWUgYXRsZWFzdCBoYXMgdGhlIHNhbWUgcHJvcGVydGllcyBhbmQgbWV0aG9kcyBvZiBBYnN0cmFjdFRpbWVyXG5leHBvcnQgY29uc3QgdmFsaWRUZWNobmlxdWUgPSAodGVjaG5pcXVlKSA9PiB7XG4gIGNvbnN0IHZhbGlkID0gXG4gICAgdHlwZW9mIHRlY2huaXF1ZSA9PT0gJ2Z1bmN0aW9uJyAmJlxuICAgIE9iamVjdFxuICAgICAgLmdldE93blByb3BlcnR5TmFtZXMoQmFzZVRlY2huaXF1ZSlcbiAgICAgIC5yZWR1Y2UoIChwcm9wLCB2YWxpZCkgPT4gdmFsaWQgJiYgdHlwZW9mIHRlY2huaXF1ZVtwcm9wXSA9PT0gdHlwZW9mIEJhc2VUZWNobmlxdWVbcHJvcF0sIHRydWUpO1xuXG4gIHJldHVybiB2YWxpZDtcbn07XG5cbmV4cG9ydCBjb25zdCB2YWxpZEVsZW1lbnQgPSAoZWxlbWVudCkgPT4ge1xuICByZXR1cm4gZWxlbWVudCAmJiBlbGVtZW50LnRvU3RyaW5nKCkuaW5kZXhPZignRWxlbWVudCcpID4gLTE7XG59O1xuXG5leHBvcnQgY29uc3QgdmFsaWRhdGVDcml0ZXJpYSA9ICh7IGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldyB9KSA9PiB7XG4gIGxldCBpbnZhbGlkID0gZmFsc2UsIHJlYXNvbnMgPSBbXTsgXG5cbiAgaWYodHlwZW9mIGluVmlld1RocmVzaG9sZCAhPT0gJ251bWJlcicgfHwgaW5WaWV3VGhyZXNob2xkID4gMSkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgnaW5WaWV3VGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgZXF1YWwgdG8gb3IgbGVzcyB0aGFuIDEnKTtcbiAgfVxuXG4gIGlmKHR5cGVvZiB0aW1lSW5WaWV3ICE9PSAnbnVtYmVyJyB8fCB0aW1lSW5WaWV3IDwgMCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgndGltZUluVmlldyBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdG8gb3IgZXF1YWwgMCcpO1xuICB9XG5cbiAgcmV0dXJuIHsgaW52YWxpZCwgcmVhc29uczogcmVhc29ucy5qb2luKCcgfCAnKSB9O1xufTtcblxuZXhwb3J0IGNvbnN0IHZhbGlkYXRlU3RyYXRlZ3kgPSAoeyBhdXRvc3RhcnQsIHRlY2huaXF1ZXMsIGNyaXRlcmlhIH0pID0+IHtcbiAgbGV0IGludmFsaWQgPSBmYWxzZSwgcmVhc29ucyA9IFtdO1xuXG4gIGlmKHR5cGVvZiBhdXRvc3RhcnQgIT09ICdib29sZWFuJykge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgnYXV0b3N0YXJ0IG11c3QgYmUgYm9vbGVhbicpO1xuICB9XG5cbiAgaWYoIUFycmF5LmlzQXJyYXkodGVjaG5pcXVlcykgfHwgdGVjaG5pcXVlcy5sZW5ndGggPT09IDApIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ3RlY2huaXF1ZXMgbXVzdCBiZSBhbiBhcnJheSBjb250YWluaW5nIGF0bGVhc3Qgb24gbWVhc3VyZW1lbnQgdGVjaG5pcXVlcycpO1xuICB9XG5cbiAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVDcml0ZXJpYShjcml0ZXJpYSk7XG5cbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2godmFsaWRhdGVkLnJlYXNvbnMpO1xuICB9XG5cbiAgcmV0dXJuIHsgaW52YWxpZCwgcmVhc29uczogcmVhc29ucy5qb2luKCcgfCAnKSB9O1xufTsiLCIvKipcbiAqIEV2ZW50cyBtb2R1bGVcbiAqIEBtb2R1bGUgTWVhc3VyZW1lbnQvRXZlbnRzXG4gKiByZXByZXNlbnRzIEV2ZW50IGNvbnN0YW50c1xuICovXG5cbi8qKiByZXByZXNlbnRzIHRoYXQgZWxlbWVudCBpcyBpbiB2aWV3IGFuZCBtZWFzdXJlbWVudCBoYXMgc3RhcnRlZCAqL1xuZXhwb3J0IGNvbnN0IFNUQVJUID0gJ3N0YXJ0Jztcbi8qKiByZXByZXNlbnRzIGEgdmlld2FibGUgbWVhc3VyZW1lbnQgc3RvcC4gVGhpcyBvY2N1cnMgd2hlbiBtZWFzdXJlbWVudCBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgdGhlIGVsZW1lbnQgaGFzIGdvbmUgb3V0IG9mIHZpZXcgKi9cbmV4cG9ydCBjb25zdCBTVE9QID0gJ3N0b3AnO1xuLyoqIHJlcHJlc2VudHMgYSB2aWV3YWJsZSBjaGFuZ2UgZXZlbnQuIEVpdGhlciBtZWFzdXJlbWVudCBoYXMgc3RhcnRlZCwgc3RvcHBlZCwgb3IgdGhlIGVsZW1lbnQncyBpbiB2aWV3IGFtb3VudCAodmlld2FibGUgcGVyY2VudGFnZSkgaGFzIGNoYW5nZWQgKi9cbmV4cG9ydCBjb25zdCBDSEFOR0UgPSAnY2hhbmdlJztcbi8qKiByZXByZXNlbnRzIHRoYXQgdmlld2FiaWxpdHkgbWVhc3VyZW1lbnQgaGFzIGNvbXBsZXRlZC4gdGhlIGVsZW1lbnQgaGFzIGJlZW4gaW4gdmlldyBmb3IgdGhlIGR1cmF0aW9uIHNwZWNpZmllZCBpbiB0aGUgbWVhc3VyZW1lbnQgY3JpdGVyaWEgKi9cbmV4cG9ydCBjb25zdCBDT01QTEVURSA9ICdjb21wbGV0ZSc7XG4vKiogcmVwcmVzZW50cyB0aGF0IG5vIGNvbXBhdGlibGUgdGVjaG5pcXVlcyBoYXZlIGJlZW4gZm91bmQgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoICovXG5leHBvcnQgY29uc3QgVU5NRUFTVVJFQUJMRSA9ICd1bm1lYXN1cmVhYmxlJztcbi8qKiBpbnRlcm5hbCByZXByZXNlbnRhdGlvbiBvZiB0aGUgdmlld2FibGUgc3RhdGUgb2YgdGhlIGVsZW1lbnQgYXMgaW4gdmlldyAqL1xuZXhwb3J0IGNvbnN0IElOVklFVyA9ICdpbnZpZXcnO1xuLyoqIGludGVybmFsIHJlcHJlc2VudGF0aW9uIG9mIHRoZSB2aWV3YWJsZSBzdGF0ZSBvZiB0aGUgZWxlbWVudCBhcyBvdXQgb2YgdmlldyAqL1xuZXhwb3J0IGNvbnN0IE9VVFZJRVcgPSAnb3V0dmlldyc7ICIsImltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0IHsgREVGQVVMVF9TVFJBVEVHWSB9IGZyb20gJy4vU3RyYXRlZ2llcy8nO1xuaW1wb3J0IHsgdmFsaWRUZWNobmlxdWUsIHZhbGlkYXRlU3RyYXRlZ3kgfSBmcm9tICcuLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vRXZlbnRzJztcblxuLyoqXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYSBtZWFzdXJlbWVudCBleGVjdXRvclxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZWFzdXJlbWVudEV4ZWN1dG9yIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5ldyBpbnN0YW5jZSBvZiBhIE1lYXN1cmVtZW50RXhlY3V0b3JcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxlbWVudCAtIGEgSFRNTCBlbGVtZW50IHRvIG1lYXN1cmVcbiAgICogQHBhcmFtIHtPYmplY3R9IHN0cmF0ZWd5IC0gYSBzdHJhdGVneSBvYmplY3QgZGVmaW5pbmcgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZXMgYW5kIHdoYXQgY3JpdGVyaWEgY29uc3RpdHV0ZSBhIHZpZXdhYmxlIHN0YXRlLlxuICAgKiBTZWUgT3BlblZWLlN0cmF0ZWdpZXMgREVGQVVMVF9TVFJBVEVHWSBhbmQgU3RyYXRlZ3lGYWN0b3J5IGZvciBtb3JlIGRldGFpbHMgb24gcmVxdWlyZWQgcGFyYW1zXG4gICAqL1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBzdHJhdGVneSA9IHt9KSB7XG4gICAgLyoqIEBwcml2YXRlIHtPYmplY3R9IGV2ZW50IGxpc3RlbmVyIGFycmF5cyAqL1xuICAgIHRoaXMuX2xpc3RlbmVycyA9IHsgc3RhcnQ6IFtdLCBzdG9wOiBbXSwgY2hhbmdlOiBbXSwgY29tcGxldGU6IFtdLCB1bm1lYXN1cmVhYmxlOiBbXSB9O1xuICAgIC8qKiBAcHJpdmF0ZSB7SFRNTEVsZW1lbnR9IEhUTUwgZWxlbWVudCB0byBtZWFzdXJlICovXG4gICAgdGhpcy5fZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgLyoqIEBwcml2YXRlIHtPYmplY3R9IG1lYXN1cmVtZW50IHN0cmF0ZWd5ICovXG4gICAgdGhpcy5fc3RyYXRlZ3kgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NUUkFURUdZLCBzdHJhdGVneSk7XG4gICAgLyoqIEBwcml2YXRlIHtCb29sZWFufSB0cmFja3Mgd2hldGhlciB2aWV3YWJpbGl0eSBjcml0ZXJpYSBoYXMgYmVlbiBtZXQgKi9cbiAgICB0aGlzLl9jcml0ZXJpYU1ldCA9IGZhbHNlO1xuXG4gICAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVTdHJhdGVneSh0aGlzLl9zdHJhdGVneSk7XG5cbiAgICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xuICAgICAgdGhyb3cgdmFsaWRhdGVkLnJlYXNvbnM7XG4gICAgfVxuXG4gICAgLyoqIEBwcml2YXRlIHtCYXNlVGVjaG5pcXVlfSB0ZWNobmlxdWUgdG8gbWVhc3VyZSB2aWV3YWJpbGl0eSB3aXRoICovXG4gICAgdGhpcy5fdGVjaG5pcXVlID0gdGhpcy5fc2VsZWN0VGVjaG5pcXVlKHRoaXMuX3N0cmF0ZWd5LnRlY2huaXF1ZXMpO1xuICAgIFxuICAgIGlmKHRoaXMuX3RlY2huaXF1ZSkge1xuICAgICAgdGhpcy5fYWRkU3Vic2NyaXB0aW9ucyh0aGlzLl90ZWNobmlxdWUpO1xuICAgIH0gICBcblxuICAgIGlmKHRoaXMudW5tZWFzdXJlYWJsZSkge1xuICAgICAgLy8gZmlyZSB1bm1lYXN1cmVhYmxlIGFmdGVyIGN1cnJlbnQgSlMgbG9vcCBjb21wbGV0ZXMgXG4gICAgICAvLyBzbyBvcHBvcnR1bml0eSBpcyBnaXZlbiBmb3IgY29uc3VtZXJzIHRvIHByb3ZpZGUgdW5tZWFzdXJlYWJsZSBjYWxsYmFja1xuICAgICAgc2V0VGltZW91dCggKCkgPT4gdGhpcy5fcHVibGlzaChFdmVudHMuVU5NRUFTVVJFQUJMRSwgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzLl9lbGVtZW50KSksIDApO1xuICAgIH1cbiAgICBlbHNlIGlmKHRoaXMuX3N0cmF0ZWd5LmF1dG9zdGFydCkge1xuICAgICAgdGhpcy5fdGVjaG5pcXVlLnN0YXJ0KCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFxuICAgKiBzdGFydHMgdmlld2FiaWxpdHkgbWVhc3VybWVudCB1c2luZyB0aGUgc2VsZWN0ZWQgdGVjaG5pcXVlXG4gICAqIEBwdWJsaWNcbiAgICovXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMuX3RlY2huaXF1ZS5zdGFydCgpO1xuICB9XG5cbiAgLyoqXG4gICAqIGRpc3Bvc2UgdGhlIG1lYXN1cm1lbnQgdGVjaG5pcXVlIGFuZCBhbnkgdGltZXJzXG4gICAqIEBwdWJsaWNcbiAgICovXG4gIGRpc3Bvc2UoKSB7XG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWUuZGlzcG9zZSgpO1xuICAgIH1cbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICB0aGlzLnRpbWVyLmRpc3Bvc2UoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlIHZpZXdhYmlsaXR5IHRyYWNraW5nIHN0YXJ0XG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBzdGFydHMgdHJhY2tpbmdcbiAgICogQHJldHVybiB7TWVhc3VybWVudEV4ZWN1dG9yfSAtIHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25WaWV3YWJsZVN0YXJ0KGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RBUlQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB2aWV3YWJpbGl0eSB0cmFja2luZyBzdG9wLlxuICAgKiBAcHVibGljXG4gICAqIEBwYXJhbSB7RnVuY3Rpb25+dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBpcyBjYWxsZWQgd2hlbiB2aWV3YWJpbGl0eSBoYXMgcHJldmlvdXNseSBzdGFydGVkLCBidXQgZWxlbWVudCBpcyBub3cgb3V0IG9mIHZpZXdcbiAgICogQHJldHVybiB7TWVhc3VyZW1lbnRFeGVjdXRvcn0gLSByZXR1cm5zIGluc3RhbmNlIG9mIE1lYXN1cmVtZW50RXhlY3V0b3IgYXNzb2NpYXRlZCB3aXRoIHRoaXMgY2FsbGJhY2tcbiAgICovXG4gIG9uVmlld2FibGVTdG9wKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuU1RPUCk7XG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlIHZpZXdhYmlsaXR5IGNoYW5nZS5cbiAgICogQHB1YmxpY1xuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn52aWV3YWJsZUNhbGxiYWNrfSBjYWxsYmFjayAtIGNhbGxlZCB3aGVuIHRoZSB2aWV3YWJsZSBwZXJjZW50YWdlIG9mIHRoZSBlbGVtZW50IGhhcyBjaGFuZ2VkXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IC0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJlbWVudEV4ZWN1dG9yIGFzc29jaWF0ZWQgd2l0aCB0aGlzIGNhbGxiYWNrXG4gICAqL1xuICBvblZpZXdhYmxlQ2hhbmdlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBFdmVudHMuQ0hBTkdFKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBIYW5kbGUgdmlld2FiaWxpdHkgY29tcGxldGUuXG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiBlbGVtZW50IGhhcyBiZWVuIGluIHZpZXcgZm9yIHRoZSBkdXJhdGlvbiBzcGVjaWZpZWQgaW4gdGhlIG1lYXN1cmVtZW50IHN0cmF0ZWd5IGNvbmZpZ1xuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSAtIHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25WaWV3YWJsZUNvbXBsZXRlKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DT01QTEVURSk7XG4gICAgLy8gaWYgdmlld2FibGl0eSBjcml0ZXJpYSBhbHJlYWR5IG1ldCwgZmlyZSBjYWxsYmFjayBpbW1lZGlhdGVseVxuICAgIGlmKHRoaXMuY3JpdGVyaWFNZXQpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZUNoYW5nZShFdmVudHMuQ09NUExFVEUsIHRoaXMuX3RlY2huaXF1ZSk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB1bm1lYXN1cmVhYmxlIGV2ZW50XG4gICAqIEBwdWJsaWNcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+dmlld2FibGVDYWxsYmFja30gY2FsbGJhY2sgLSBjYWxsZWQgd2hlbiBubyBzdWl0YWJsZSBtZWFzdXJlbWVudCB0ZWNobmlxdWVzIGFyZSBhdmFpbGFibGUgZnJvbSB0aGUgdGVjaG5pcXVlcyBwcm92aWRlZFxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSAtIHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgb25Vbm1lYXN1cmVhYmxlKGNhbGxiYWNrKSB7XG4gICAgdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5VTk1FQVNVUkVBQkxFKTtcbiAgICAvLyBpZiBleGVjdXRvciBpcyBhbHJlYWR5IHVubWVhc3VyZWFibGUsIGZpcmUgY2FsbGJhY2sgaW1tZWRpYXRlbHlcbiAgICBpZih0aGlzLnVubWVhc3VyZWFibGUpIHtcbiAgICAgIHRoaXMuX3RlY2huaXF1ZUNoYW5nZShFdmVudHMuVU5NRUFTVVJFQUJMRSlcbiAgICB9XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAgLyoqXG4gICAqIEBjYWxsYmFjayBGdW5jdGlvbn52aWV3YWJsZUNhbGxiYWNrXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gZW52aXJvbm1lbnQgYW5kIG1lYXN1cmVtZW50IGRldGFpbHMgb2Ygdmlld2FibGUgZXZlbnRcbiAgICogQHJldHVybiB7TWVhc3VybWVudEV4ZWN1dG9yfSAtIHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cblxuICAvKipcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gLSB3aGV0aGVyIE1lYXN1cmVtZW50RXhlY3V0b3IgaW5zdGFuY2UgaXMgY2FwYWJsZSBvZiBtZWFzdXJpbmcgdmlld2FiaWxpdHlcbiAgICovXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAhdGhpcy5fdGVjaG5pcXVlIHx8IHRoaXMuX3RlY2huaXF1ZS51bm1lYXN1cmVhYmxlO1xuICB9XG5cbiAgLyoqXG4gICAqIEluc3RhbnRpYXRlcyBhbmQgZmlsdGVycyBsaXN0IG9mIGF2YWlsYWJsZSBtZWFzdXJlbWVudCB0ZWNobnFpdWVzIHRvIHRoZSBmaXJzdCB1bm1lYXN1cmVhYmxlIHRlY2huaXF1ZVxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtBcnJheX0gLSBsaXN0IG9mIHRlY2huaXF1ZXMgYXZhaWxhYmxlIHRvIG1lYXN1cmUgdmlld2FiaWxpdHkgd2l0aFxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSAtIHNlbGVjdGVkIHRlY2huaXF1ZVxuICAgKi9cbiAgX3NlbGVjdFRlY2huaXF1ZSh0ZWNobmlxdWVzKSB7XG4gICAgcmV0dXJuIHRlY2huaXF1ZXNcbiAgICAgICAgICAgIC5maWx0ZXIodmFsaWRUZWNobmlxdWUpXG4gICAgICAgICAgICAubWFwKHRoaXMuX2luc3RhbnRpYXRlVGVjaG5pcXVlLmJpbmQodGhpcykpXG4gICAgICAgICAgICAuZmluZCh0ZWNobmlxdWUgPT4gIXRlY2huaXF1ZS51bm1lYXN1cmVhYmxlKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBjcmVhdGVzIGluc3RhbmNlIG9mIHRlY2huaXF1ZVxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn0gLSB0ZWNobmlxdWUgY29uc3RydWN0b3JcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gLSBpbnN0YW5jZSBvZiB0ZWNobmlxdWUgcHJvdmlkZWRcbiAgICovXG4gIF9pbnN0YW50aWF0ZVRlY2huaXF1ZSh0ZWNobmlxdWUpIHtcbiAgICByZXR1cm4gbmV3IHRlY2huaXF1ZShlbGVtZW50LCB0aGlzLl9zdHJhdGVneS5jcml0ZXJpYSk7XG4gIH1cblxuICAvKipcbiAgICogYWRkcyBldmVudCBsaXN0ZW5lcnMgdG8gdGVjaG5pcXVlIFxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0ge0Jhc2VUZWNobmlxdWV9IC0gdGVjaG5pcXVlIHRvIGFkZCBldmVudCBsaXN0ZW5lcnMgdG9cbiAgICovXG4gIF9hZGRTdWJzY3JpcHRpb25zKHRlY2huaXF1ZSkge1xuICAgIGlmKHRlY2huaXF1ZSkge1xuICAgICAgdGVjaG5pcXVlLm9uSW5WaWV3KHRoaXMuX3RlY2huaXF1ZUNoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5JTlZJRVcsIHRlY2huaXF1ZSkpO1xuICAgICAgdGVjaG5pcXVlLm9uQ2hhbmdlVmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuQ0hBTkdFLCB0ZWNobmlxdWUpKTtcbiAgICAgIHRlY2huaXF1ZS5vbk91dFZpZXcodGhpcy5fdGVjaG5pcXVlQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLk9VVFZJRVcsIHRlY2huaXF1ZSkpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBoYW5kbGVzIHZpZXdhYmxlIGNoYW5nZSBldmVudHMgZnJvbSBhIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxuICAgKiBAcHJpdmF0ZVxuICAgKiBAcGFyYW0gIHtTdHJpbmd9IC0gY2hhbmdlIHR5cGUuIFNlZSBNZWFzdXJlbWVudC9FdmVudHMgbW9kdWxlIGZvciBsaXN0IG9mIGNoYW5nZXNcbiAgICogQHBhcmFtICB7T2JqZWN0fSAtIHRlY2huaXF1ZSB0aGF0IHJlcG9ydGVkIGNoYW5nZS4gTWF5IGJlIHVuZGVmaW5lZCBpbiBjYXNlIG9mIHVubWVhc3VyZWFibGUgZXZlbnRcbiAgICovXG4gIF90ZWNobmlxdWVDaGFuZ2UoY2hhbmdlLCB0ZWNobmlxdWUgPSB7fSkge1xuICAgIGxldCBldmVudE5hbWU7XG4gICAgY29uc3QgZGV0YWlscyA9IHRoaXMuX2FwcGVuZEVudmlyb25tZW50KHRlY2huaXF1ZSk7XG5cbiAgICBzd2l0Y2goY2hhbmdlKSB7XG4gICAgICBjYXNlIEV2ZW50cy5JTlZJRVc6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCl7XG4gICAgICAgICAgdGhpcy50aW1lciA9IG5ldyBJblZpZXdUaW1lcih0aGlzLl9zdHJhdGVneS5jcml0ZXJpYS50aW1lSW5WaWV3KTtcbiAgICAgICAgICB0aGlzLnRpbWVyLmVsYXBzZWQodGhpcy5fdGltZXJFbGFwc2VkLmJpbmQodGhpcywgdGVjaG5pcXVlKSk7XG4gICAgICAgICAgdGhpcy50aW1lci5zdGFydCgpO1xuICAgICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVEFSVDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLkNIQU5HRTpcbiAgICAgICAgZXZlbnROYW1lID0gY2hhbmdlO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuQ09NUExFVEU6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCkge1xuICAgICAgICAgIHRoaXMuX2NyaXRlcmlhTWV0ID0gdHJ1ZTtcbiAgICAgICAgICBldmVudE5hbWUgPSBjaGFuZ2U7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5PVVRWSUVXOlxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpIHtcbiAgICAgICAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICAgICAgICB0aGlzLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnRpbWVyO1xuICAgICAgICAgIH1cbiAgICAgICAgICBldmVudE5hbWUgPSBFdmVudHMuU1RPUDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLlVOTUVBU1VSRUFCTEU6IFxuICAgICAgICBldmVudE5hbWUgPSBFdmVudHMuVU5NRUFTVVJFQUJMRTtcbiAgICB9XG5cbiAgICBpZihldmVudE5hbWUpIHtcbiAgICAgIHRoaXMuX3B1Ymxpc2goZXZlbnROYW1lLCBkZXRhaWxzKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogcHVibGlzaGVzIGV2ZW50cyB0byBhdmFpbGFibGUgbGlzdGVuZXJzXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge1N0cmluZ30gLSBldmVudCBuYW1lXG4gICAqIEBwYXJhbSAgeyp9IC0gdmFsdWUgdG8gY2FsbCBjYWxsYmFjayB3aXRoXG4gICAqL1xuICBfcHVibGlzaChldmVudCwgdmFsdWUpIHtcbiAgICBpZihBcnJheS5pc0FycmF5KHRoaXMuX2xpc3RlbmVyc1tldmVudF0pKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLmZvckVhY2goIGwgPT4gbCh2YWx1ZSkgKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogY2FsbGJhY2sgZm9yIHRpbWVyIGVsYXBzZWQgXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge0Jhc2VUZWNobmlxdWV9IC0gdGVjaG5pcXVlIHVzZWQgdG8gcGVyZm9ybSBtZWFzdXJlbWVudFxuICAgKi9cbiAgX3RpbWVyRWxhcHNlZCh0ZWNobmlxdWUpIHtcbiAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLkNPTVBMRVRFLCB0ZWNobmlxdWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc29jaWF0ZXMgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aCBldmVudCBcbiAgICogQHByaXZhdGVcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gLSBjYWxsYmFjayBmdW5jdGlvbiB0byBhc3NvY2lhdGUgd2l0aCBldmVudFxuICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnQgLSBldmVudCB0byBhc3NvY2lhdGUgY2FsbGJhY2sgZnVuY3Rpb24gd2l0aFxuICAgKiBAcmV0dXJuIHtNZWFzdXJlbWVudEV4ZWN1dG9yfSAtIHJldHVybnMgaW5zdGFuY2Ugb2YgTWVhc3VyZW1lbnRFeGVjdXRvciBhc3NvY2lhdGVkIHdpdGggdGhpcyBjYWxsYmFja1xuICAgKi9cbiAgX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHRoaXMuX2xpc3RlbmVyc1tldmVudF0gJiYgdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ0NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvKipcbiAgICogQ29tYmluZXMgZW52aXJvbm1lbnQgZGV0YWlscyB3aXRoIG1lYXN1cmVtZW50IHRlY2huaXF1ZSBkZXRhaWxzXG4gICAqIEBwcml2YXRlXG4gICAqIEBwYXJhbSAge0Jhc2VUZWNobmlxdWV9IC0gdGVjaG5pcXVlIHRvIGdldCBtZWFzdXJlbWVudCBkZXRhaWxzIGZyb20gXG4gICAqIEByZXR1cm4ge09iamVjdH0gLSBFbnZpcm9ubWVudCBkZXRhaWxzIGFuZCBtZWFzdXJlbWVudCBkZXRhaWxzIGNvbWJpbmVkXG4gICAqL1xuICBfYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oXG4gICAgICB7fSwgXG4gICAgICB7IFxuICAgICAgICBwZXJjZW50Vmlld2FibGU6IHRlY2huaXF1ZS5wZXJjZW50Vmlld2FibGUgfHwgLTEsIFxuICAgICAgICB0ZWNobmlxdWU6IHRlY2huaXF1ZS50ZWNobmlxdWVOYW1lIHx8IC0xLCBcbiAgICAgICAgdmlld2FibGU6IHRlY2huaXF1ZS52aWV3YWJsZSB8fCAtMSBcbiAgICAgIH0sIFxuICAgICAgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzLl9lbGVtZW50KSBcbiAgICApO1xuICB9XG59IiwiLyoqXG4gKiBDbGFzcyByZXByZXNlbnRpbmcgYmFzaWMgZnVuY3Rpb25hbGl0eSBvZiBhIE1lYXN1cmVtZW50IFRlY2huaXF1ZVxuICogU29tZSBvZiBpdCdzIG1lbWJlcnMgYXJlIGludGVuZGVkIHRvIGJlIG92ZXJyaWRlbiBieSBpbmhlcml0dGluZyBjbGFzc1xuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBCYXNlVGVjaG5pcXVlIHtcbiAgLyoqXG4gICAqIEBjb25zdHJ1Y3RvclxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSAtIGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWVcbiAgICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubGlzdGVuZXJzID0ge1xuICAgICAgaW5WaWV3OltdLFxuICAgICAgb3V0VmlldzpbXSxcbiAgICAgIGNoYW5nZVZpZXc6W11cbiAgICB9O1xuXG4gICAgdGhpcy5wZXJjZW50Vmlld2FibGUgPSAwLjA7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBpbiB2aWV3XG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufmNoYW5nZUNhbGxiYWNrfSAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBlbGVtZW50IGlzIGluIHZpZXdcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gLSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvbkluVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdpblZpZXcnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0ZWNobmlxdWUgZGV0ZXJtaW5lcyBlbGVtZW50IHZpZXdhYmlsaXR5IGhhcyBjaGFuZ2VkXG4gICAqIEBwYXJhbSAge0Z1bmN0aW9ufmNoYW5nZUNhbGxiYWNrfSAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBlbGVtZW50J3Mgdmlld2FiaWxpdHkgaGFzIGNoYW5nZWRcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gLSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvbkNoYW5nZVZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnY2hhbmdlVmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRlY2huaXF1ZSBkZXRlcm1pbmVzIGVsZW1lbnQgaXMgbm8gbG9uZ2VyIGluIHZpZXdcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQgaXMgbm8gbG9uZ2VyIGluIHZpZXdcbiAgICogQHJldHVybiB7QmFzZVRlY2huaXF1ZX0gLSBpbnN0YW5jZSBvZiBCYXNlVGVjaG5pcXVlIGFzc29jaWF0ZWQgd2l0aCBjYWxsYmFjay4gQ2FuIGJlIHVzZWQgdG8gY2hhaW4gY2FsbGJhY2sgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBvbk91dFZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnb3V0VmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIEBjYWxsYmFjayBGdW5jdGlvbn5jaGFuZ2VDYWxsYmFja1xuICAgKi9cblxuICAvKipcbiAgICogQXNzb2NpYXRlIGNhbGxiYWNrIHdpdGggbmFtZWQgZXZlbnRcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZXZlbnQgb2NjdXJzXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudCAtIG5hbWUgb2YgZXZlbnQgdG8gYXNzb2NpYXRlIHdpdGggY2FsbGJhY2tcbiAgICovXG4gIGFkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLmxpc3RlbmVyc1tldmVudF0pIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzW2V2ZW50XS5wdXNoKGNhbGxiYWNrKTtcbiAgICB9XG4gICAgZWxzZSBpZih0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93ICdjYWxsYmFjayBtdXN0IGJlIGZ1bmN0aW9uJztcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8qKlxuICAgKiBlbXB0eSBkaXNwb3NlIG1lbWJlci4gc2hvdWxkIGJlIGltcGxlbWVudGVkIGJ5IGluaGVyaXR0aW5nIGNsYXNzXG4gICAqL1xuICBkaXNwb3NlKCkge31cblxuICAvKipcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gLSBkZWZpbmVzIHdoZXRoZXIgdGhlIHRlY2huaXF1ZSBpcyBjYXBhYmxlIG9mIG1lYXN1cmluZyBpbiB0aGUgY3VycmVudCBlbnZpcm9ubWVudFxuICAgKi9cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59IC0gZGVmaW5lcyB3aGV0aGVyIHRoZSB0ZWNobmlxdWUgaGFzIGRldGVybWluZWQgdGhhdCB0aGUgbWVhc3VyZWQgZWxlbWVudCBpcyBpbiB2aWV3XG4gICAqL1xuICBnZXQgdmlld2FibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIEByZXR1cm4ge1N0cmluZ30gLSBuYW1lIG9mIHRoZSBtZWFzdXJlbWVudCB0ZWNobmlxdWVcbiAgICovXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnQmFzZVRlY2huaXF1ZSc7XG4gIH1cbn0iLCIvKipcbiAqIENsYXNzIHJlcHJlc2VudGluZyBiYXNpYyBmdW5jdGlvbmFsaXR5IG9mIGEgTWVhc3VyZW1lbnQgVGVjaG5pcXVlXG4gKiBTb21lIG9mIGl0J3MgbWVtYmVycyBhcmUgaW50ZW5kZWQgdG8gYmUgb3ZlcnJpZGVuIGJ5IGluaGVyaXR0aW5nIGNsYXNzXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhc2VUZWNobmlxdWUge1xuICAvKipcbiAgICogQGNvbnN0cnVjdG9yXG4gICAqIEByZXR1cm4ge0Jhc2VUZWNobmlxdWV9IC0gaW5zdGFuY2Ugb2YgQmFzZVRlY2huaXF1ZVxuICAgKi9cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7XG4gICAgICBpblZpZXc6W10sXG4gICAgICBvdXRWaWV3OltdLFxuICAgICAgY2hhbmdlVmlldzpbXVxuICAgIH07XG5cbiAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IDAuMDtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWZpbmVzIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiB0ZWNobmlxdWUgZGV0ZXJtaW5lcyBlbGVtZW50IGlzIGluIHZpZXdcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQgaXMgaW4gdmlld1xuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSAtIGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cbiAgICovXG4gIG9uSW5WaWV3KGNiKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRkQ2FsbGJhY2soY2IsJ2luVmlldycpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgY2FsbGJhY2sgdG8gY2FsbCB3aGVuIHRlY2huaXF1ZSBkZXRlcm1pbmVzIGVsZW1lbnQgdmlld2FiaWxpdHkgaGFzIGNoYW5nZWRcbiAgICogQHBhcmFtICB7RnVuY3Rpb25+Y2hhbmdlQ2FsbGJhY2t9IC0gY2FsbGJhY2sgdG8gY2FsbCB3aGVuIGVsZW1lbnQncyB2aWV3YWJpbGl0eSBoYXMgY2hhbmdlZFxuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSAtIGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cbiAgICovXG4gIG9uQ2hhbmdlVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdjaGFuZ2VWaWV3Jyk7XG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyBjYWxsYmFjayB0byBjYWxsIHdoZW4gdGVjaG5pcXVlIGRldGVybWluZXMgZWxlbWVudCBpcyBubyBsb25nZXIgaW4gdmlld1xuICAgKiBAcGFyYW0gIHtGdW5jdGlvbn5jaGFuZ2VDYWxsYmFja30gLSBjYWxsYmFjayB0byBjYWxsIHdoZW4gZWxlbWVudCBpcyBubyBsb25nZXIgaW4gdmlld1xuICAgKiBAcmV0dXJuIHtCYXNlVGVjaG5pcXVlfSAtIGluc3RhbmNlIG9mIEJhc2VUZWNobmlxdWUgYXNzb2NpYXRlZCB3aXRoIGNhbGxiYWNrLiBDYW4gYmUgdXNlZCB0byBjaGFpbiBjYWxsYmFjayBkZWZpbml0aW9ucy5cbiAgICovXG4gIG9uT3V0VmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdvdXRWaWV3Jyk7XG4gIH1cblxuICAvKipcbiAgICogQGNhbGxiYWNrIEZ1bmN0aW9ufmNoYW5nZUNhbGxiYWNrXG4gICAqL1xuXG4gIC8qKlxuICAgKiBBc3NvY2lhdGUgY2FsbGJhY2sgd2l0aCBuYW1lZCBldmVudFxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayAtIGNhbGxiYWNrIHRvIGNhbGwgd2hlbiBldmVudCBvY2N1cnNcbiAgICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50IC0gbmFtZSBvZiBldmVudCB0byBhc3NvY2lhdGUgd2l0aCBjYWxsYmFja1xuICAgKi9cbiAgYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nICYmIHRoaXMubGlzdGVuZXJzW2V2ZW50XSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ2NhbGxiYWNrIG11c3QgYmUgZnVuY3Rpb24nO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLyoqXG4gICAqIGVtcHR5IGRpc3Bvc2UgbWVtYmVyLiBzaG91bGQgYmUgaW1wbGVtZW50ZWQgYnkgaW5oZXJpdHRpbmcgY2xhc3NcbiAgICovXG4gIGRpc3Bvc2UoKSB7fVxuXG4gIC8qKlxuICAgKiBAcmV0dXJuIHtCb29sZWFufSAtIGRlZmluZXMgd2hldGhlciB0aGUgdGVjaG5pcXVlIGlzIGNhcGFibGUgb2YgbWVhc3VyaW5nIGluIHRoZSBjdXJyZW50IGVudmlyb25tZW50XG4gICAqL1xuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogQHJldHVybiB7Qm9vbGVhbn0gLSBkZWZpbmVzIHdoZXRoZXIgdGhlIHRlY2huaXF1ZSBoYXMgZGV0ZXJtaW5lZCB0aGF0IHRoZSBtZWFzdXJlZCBlbGVtZW50IGlzIGluIHZpZXdcbiAgICovXG4gIGdldCB2aWV3YWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogQHJldHVybiB7U3RyaW5nfSAtIG5hbWUgb2YgdGhlIG1lYXN1cmVtZW50IHRlY2huaXF1ZVxuICAgKi9cbiAgZ2V0IHRlY2huaXF1ZU5hbWUoKSB7XG4gICAgcmV0dXJuICdCYXNlVGVjaG5pcXVlJztcbiAgfVxufSIsImltcG9ydCBCYXNldGVjaG5pcXVlIGZyb20gJy4vQmFzZXRlY2huaXF1ZSc7XG5pbXBvcnQgeyB2YWxpZEVsZW1lbnQgfSBmcm9tICcuLi8uLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlciBleHRlbmRzIEJhc2V0ZWNobmlxdWUge1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBjcml0ZXJpYSkge1xuICAgIHN1cGVyKGVsZW1lbnQsIGNyaXRlcmlhKTtcbiAgICBpZihjcml0ZXJpYSAhPT0gdW5kZWZpbmVkICYmIGVsZW1lbnQpIHtcbiAgICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgICB0aGlzLmNyaXRlcmlhID0gY3JpdGVyaWE7XG4gICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xuICAgICAgdGhpcy5zdGFydGVkID0gZmFsc2U7XG4gICAgICB0aGlzLm5vdGlmaWNhdGlvbkxldmVscyA9IFswLDAuMSwwLjIsMC4zLDAuNCwwLjUsMC42LDAuNywwLjgsMC45LDFdO1xuICAgICAgaWYodGhpcy5ub3RpZmljYXRpb25MZXZlbHMuaW5kZXhPZih0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkgPT09IC0xKSB7XG4gICAgICAgIHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzLnB1c2godGhpcy5jcml0ZXJpYS5pblZpZXdUaHJlc2hvbGQpO1xuICAgICAgfVxuICAgIH1cbiAgICBlbHNlIGlmKCFlbGVtZW50KSB7XG4gICAgICB0aHJvdyAnZWxlbWVudCBub3QgcHJvdmlkZWQnO1xuICAgIH0gXG4gICAgZWxzZSBpZighY3JpdGVyaWEpIHtcbiAgICAgIHRocm93ICdjcml0ZXJpYSBub3QgcHJvdmlkZWQnO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyKHRoaXMudmlld2FibGVDaGFuZ2UuYmluZCh0aGlzKSx7IHRocmVzaG9sZDogdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgfSk7XG4gICAgdGhpcy5vYnNlcnZlci5vYnNlcnZlKHRoaXMuZWxlbWVudCk7XG4gIH1cblxuICBkaXNwb3NlKCkge1xuICAgIGlmKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMub2JzZXJ2ZXIudW5vYnNlcnZlKGVsZW1lbnQpO1xuICAgICAgdGhpcy5vYnNlcnZlci5kaXNjb25uZWN0KGVsZW1lbnQpO1xuICAgIH1cbiAgfVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAoIXdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlciB8fCB0aGlzLnVzZXNQb2x5ZmlsbCApIHx8ICF2YWxpZEVsZW1lbnQodGhpcy5lbGVtZW50KTtcbiAgfVxuXG4gIGdldCB2aWV3YWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5pblZpZXc7XG4gIH1cblxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyJztcbiAgfVxuXG4gIC8vIGluZmVyIHBvbHlmaWxsIHVzYWdlIGJ5IGNoZWNraW5nIGlmIEludGVyc2VjdGlvbk9ic2VydmVyIEFQSSBoYXMgVEhST1RUTEVfVElNRU9VVCBtZW1tYmVyXG4gIGdldCB1c2VzUG9seWZpbGwoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlRIUk9UVExFX1RJTUVPVVQgPT09ICdudW1iZXInO1xuICB9XG5cbiAgdmlld2FibGVDaGFuZ2UoZW50cmllcykge1xuICAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW87XG4gICAgICBcbiAgICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPCB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCAmJiB0aGlzLnN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5pblZpZXcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMub3V0Vmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuICAgICAgaWYoZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyA+PSB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLmluVmlldyA9IHRydWU7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmluVmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxpc3RlbmVycy5jaGFuZ2VWaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgfVxuICB9XG5cbn0iLCJpbXBvcnQgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5pbXBvcnQgUG9seWZpbGwgZnJvbSAnaW50ZXJzZWN0aW9uLW9ic2VydmVyJztcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4uLy4uL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcblxuLy8gV2Ugb25seSBuZWVkIHRvIG92ZXJyaWRlIGEgZmV3IGFzcGVjdHMgb2YgdGhlIG5hdGl2ZSBpbXBsZW1lbnRhdGlvbidzIG1lYXN1cmVyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIGV4dGVuZHMgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIge1xuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gRW52aXJvbm1lbnQuaUZyYW1lQ29udGV4dCgpID09PSBFbnZpcm9ubWVudC5pRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XG4gIH1cblxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyUG9seUZpbGwnO1xuICB9XG59IiwiZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB9IGZyb20gJy4vSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsJztcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQmFzZVRlY2huaXF1ZSB9IGZyb20gJy4vQmFzZVRlY2huaXF1ZSc7IiwiLyoqXG4gKiBTdHJhdGVnaWVzIG1vZHVsZVxuICogQG1vZHVsZSBNZWFzdXJlbWVudC9TdHJhdGVnaWVzXG4gKiByZXByZXNlbnRzIGNvbnN0YW50cyBhbmQgZmFjdG9yaWVzIHJlbGF0ZWQgdG8gbWVhc3VyZW1lbnQgc3RyYXRlZ2llcyBcbiAqL1xuXG5pbXBvcnQgKiBhcyBWYWxpZGF0b3JzIGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRlY2huaXF1ZXMgZnJvbSAnLi4vTWVhc3VyZW1lbnRUZWNobmlxdWVzLyc7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5cbi8qKlxuICogcmVwcmVzZW50cyBkZWZhdWx0IG1lYXN1cmVtZW50IHN0cmF0ZWd5LiBEZWZpbmVzIGF1dG9zdGFydCwgdGVjaG5pcXVlcywgYW5kIG1lYXN1cmVtZW50IGNyaXRlcmlhXG4gKiBAdHlwZSB7T2JqZWN0fVxuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9TVFJBVEVHWSA9IHtcbiAgYXV0b3N0YXJ0OiB0cnVlLFxuICB0ZWNobmlxdWVzOiBbTWVhc3VyZW1lbnRUZWNobmlxdWVzLkludGVyc2VjdGlvbk9ic2VydmVyLCBNZWFzdXJlbWVudFRlY2huaXF1ZXMuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5ZmlsbF0sXG4gIGNyaXRlcmlhOiBWaWV3YWJpbGl0eUNyaXRlcmlhLk1SQ19WSURFT1xufTtcblxuLyoqXG4gKiBDcmVhdGUgc3RyYXRlZ3kgb2JqZWN0IHVzaW5nIHRoZSBwcm92aWRlZCB2YWx1ZXNcbiAqIEBwYXJhbSAge0Jvb2xlYW59IGF1dG9zdGFydCAtIHdoZXRoZXIgbWVhc3VyZW1lbnQgc2hvdWxkIHN0YXJ0IGltbWVkaWF0ZWx5XG4gKiBAcGFyYW0gIHtBcnJheX0gdGVjaG5pcXVlcyAtIGxpc3Qgb2YgdGVjaG5pcXVlcyB0byB1c2UgZm9yIG1lYXN1cmVtZW50LiBGaXJzdCBub24tdW5tZWFzdXJlYWJsZSB0ZWNobmlxdWUgd2lsbCBiZSB1c2VkXG4gKiBAcGFyYW0gIHtPYmplY3R9IGNyaXRlcmlhIC0gY3JpdGVyaWEgb2JqZWN0LiBTZWUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhIGZvciBwcmUtZGVmaW5lZCBjcml0ZXJpYSBhbmQgY3JpdGVyaWEgZmFjdG9yeVxuICogQHJldHVybiB7T2JqZWN0fSAtIG9iamVjdCBjb250YWluaW5nIGFwcHJvcHJpYXRlbHkgbmFtZWQgcHJvcGVydGllcyB0byBiZSB1c2VkIGFzIG1lYXN1cmVtZW50IHN0cmF0ZWd5XG4gKi9cbmV4cG9ydCBjb25zdCBTdHJhdGVneUZhY3RvcnkgPSAoYXV0b3N0YXJ0ID0gREVGQVVMVF9TVFJBVEVHWS5hdXRvc3RhcnQsIHRlY2huaXF1ZXMgPSBERUZBVUxUX1NUUkFURUdZLnRlY2huaXF1ZXMsIGNyaXRlcmlhID0gREVGQVVMVF9TVFJBVEVHWS5jcml0ZXJpYSkgPT4ge1xuICBjb25zdCBzdHJhdGVneSA9IHsgYXV0b3N0YXJ0LCB0ZWNobmlxdWVzLCBjcml0ZXJpYSB9LFxuICAgICAgICB2YWxpZGF0ZWQgPSBWYWxpZGF0b3JzLnZhbGlkYXRlU3RyYXRlZ3koc3RyYXRlZ3kpOyAgXG5cbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcbiAgfVxuXG4gIHJldHVybiBzdHJhdGVneTtcbn07IiwiaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vTWVhc3VyZW1lbnQvRXZlbnRzJztcbmltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuL1RpbWluZy9JblZpZXdUaW1lcic7XG5pbXBvcnQgKiBhcyBTdHJhdGVnaWVzIGZyb20gJy4vTWVhc3VyZW1lbnQvU3RyYXRlZ2llcy8nO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgTWVhc3VyZW1lbnRFeGVjdXRvciBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3InO1xuaW1wb3J0ICogYXMgVmlld2FiaWxpdHlDcml0ZXJpYSBmcm9tICcuL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRlY2huaXF1ZXMgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRlY2huaXF1ZXMvJztcblxuLyoqIENsYXNzIHJlcHJlc2VudHMgdGhlIG1haW4gZW50cnkgcG9pbnQgdG8gdGhlIE9wZW5WViBsaWJyYXJ5ICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBPcGVuVlYge1xuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IGluc3RhbmNlIG9mIE9wZW5WViBcbiAgICovXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuZXhlY3V0b3JzID0gW107XG4gIH1cblxuICAvKipcbiAgICogQWxsb3dzIG1lYXN1cmVtZW50IG9mIGFuIGVsZW1lbnQgdXNpbmcgYSBzdHJhdGVneSBkZWZpbml0aW9uICBcbiAgICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsZW1lbnQgLSB0aGUgZWxlbWVudCB5b3UnZCBsaWtlIG1lYXN1cmUgdmlld2FiaWxpdHkgb25cbiAgICogQHBhcmFtICB7T2JqZWN0fSBzdHJhdGVneSAtIGFuIG9iamVjdCByZXByZXNlbnRpbmcgdGhlIHN0cmF0ZWd5IHRvIHVzZSBmb3IgbWVhc3VyZW1lbnQuIFxuICAgKiBTZWUgT3BlblZWLlN0cmF0ZWdpZXMgZm9yIFN0cmF0ZWd5RmFjdG9yeSBhbmQgREVGQVVMVF9TVFJBVEVHWSBmb3IgbW9yZSBpbmZvcm1hdGlvbi4gXG4gICAqIEByZXR1cm4ge01lYXN1cmVtZW50RXhlY3V0b3J9IC0gcmV0dXJucyBpbnN0YW5jZSBvZiBNZWFzdXJtZW50RXhlY3V0b3IuIFxuICAgKiBUaGlzIGluc3RhbmNlIGV4cG9zZXMgZXZlbnQgbGlzdGVuZXJzIG9uVmlld2FibGVTdGFydCwgb25WaWV3YWJsZVN0b3AsIG9uVmlld2FibGVDaGFuZ2UsIG9uVmlld2FibGVDb21wbGV0ZSwgYW5kIG9uVW5tZWFzdXJlYWJsZVxuICAgKiBBbHNvIGV4cG9zZXMgc3RhcnQgYW5kIGRpc3Bvc2VcbiAgICovXG4gIG1lYXN1cmVFbGVtZW50KGVsZW1lbnQsIHN0cmF0ZWd5KSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBuZXcgTWVhc3VyZW1lbnRFeGVjdXRvcihlbGVtZW50LCBzdHJhdGVneSk7XG4gICAgdGhpcy5leGVjdXRvcnMucHVzaChleGVjdXRvcik7XG4gICAgcmV0dXJuIGV4ZWN1dG9yO1xuICB9IFxuXG4gIC8qKlxuICAgKiBkZXN0cm95cyBhbGwgbWVhc3VyZW1lbnQgZXhlY3V0b3JzXG4gICAqIEByZXR1cm4ge3VuZGVmaW5lZH1cbiAgICovXG4gIGRpc3Bvc2UoKSB7XG4gICAgdGhpcy5leGVjdXRvcnMuZm9yRWFjaCggZSA9PiBlLmRpc3Bvc2UoKSApO1xuICB9XG59XG5cbi8qKlxuICogRXhwb3NlcyBhbGwgcHVibGljIGNsYXNzZXMgYW5kIGNvbnN0YW50cyBhdmFpbGFibGUgaW4gdGhlIE9wZW5WViBwYWNrYWdlXG4gKi9cbk9wZW5WVi5WaWV3YWJpbGl0eUNyaXRlcmlhID0gVmlld2FiaWxpdHlDcml0ZXJpYTtcbk9wZW5WVi5NZWFzdXJlbWVudEV4ZWN1dG9yID0gTWVhc3VyZW1lbnRFeGVjdXRvcjtcbk9wZW5WVi5NZWFzdXJlbWVudFRlY2huaXF1ZXMgPSBNZWFzdXJlbWVudFRlY2huaXF1ZXM7XG5PcGVuVlYuSW5WaWV3VGltZXIgPSBJblZpZXdUaW1lcjtcbk9wZW5WVi5TdHJhdGVnaWVzID0gU3RyYXRlZ2llcztcbk9wZW5WVi5FdmVudHMgPSBFdmVudHM7IiwiLyoqXG4gKiBWaWV3YWJpbGl0eSBDcml0ZXJpYSBtb2R1bGVcbiAqIEBtb2R1bGUgT3B0aW9ucy9WaWV3YWJpbGl0eUNyaXRlcmlhXG4gKiByZXByZXNlbnRzIGNvbnN0YW50cyBhbmQgZmFjdG9yaWVzIHJlbGF0ZWQgdG8gbWVhc3VyZW1lbnQgY3JpdGVyaWEgXG4gKi9cblxuLyoqXG4gKiBSZXByZXNlbnRzIGNyaXRlcmlhIGZvciBNUkMgdmlld2FibGUgdmlkZW8gaW1wcmVzc2lvblxuICogQHR5cGUge09iamVjdH1cbiAqL1xuZXhwb3J0IGNvbnN0IE1SQ19WSURFTyA9IHtcbiAgaW5WaWV3VGhyZXNob2xkOiAwLjUsXG4gIHRpbWVJblZpZXc6IDIwMDBcbn07XG5cbi8qKlxuICogUmVwcmVzZW50cyBjcml0ZXJpYSBmb3IgTVJDIHZpZXdhYmxlIGRpc3BsYXkgaW1wcmVzc2lvblxuICogQHR5cGUge09iamVjdH1cbiAqL1xuZXhwb3J0IGNvbnN0IE1SQ19ESVNQTEFZID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMTAwMFxufTtcblxuXG4vKipcbiAqIENyZWF0ZXMgY3VzdG9tIGNyaXRlcmlhIG9iamVjdCB1c2luZyB0aGUgdGhyZXNob2xkIGFuZCBkdXJhdGlvbiBwcm92aWRlZCBcbiAqIEBwYXJhbSAge051bWJlcn0gLSBhbW91bnQgZWxlbWVudCBtdXN0IGJlIGluIHZpZXcgYmVmb3JlIGl0IGlzIGNvbnNpZGVyZWQgaW4gdmlld1xuICogQHBhcmFtICB7TnVtYmVyfSAtIGhvdyBsb25nIGVsZW1lbnQgbXVzdCBiZSBpbiB2aWV3IGJlZm9yZSBpdCBpcyBjb25zaWRlcmVkIHZpZXdhYmxlXG4gKiBAcmV0dXJuIHtPYmplY3R9IC0gb2JqZWN0IGNvbnRhaW5pbmcgYXBwcm9wcmlhdGVseSBuYW1lZCBwcm9wZXJ0aWVzIHRvIGJlIHVzZWQgYXMgdmlld2FiaWxpdHkgY3JpdGVyaWEgXG4gKi9cbmV4cG9ydCBjb25zdCBjdXN0b21Dcml0ZXJpYSA9IChpblZpZXdUaHJlc2hvbGQgPSAwLjUsIHRpbWVJblZpZXcgPSAyMDAwKSA9PiAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSk7IiwiZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW5WaWV3VGltZXIge1xuICBjb25zdHJ1Y3RvcihkdXJhdGlvbikge1xuICAgIHRoaXMuZHVyYXRpb24gPSBkdXJhdGlvbjsgICAgICBcbiAgICB0aGlzLmxpc3RlbmVycyA9IFtdO1xuICAgIHRoaXMuY29tcGxldGVkID0gZmFsc2U7XG4gIH1cblxuICB0aW1lckNvbXBsZXRlKCkge1xuICAgIHRoaXMuY29tcGxldGVkID0gdHJ1ZTtcbiAgICB0aGlzLmxpc3RlbmVycy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICB9XG5cbiAgZWxhcHNlZChjYikge1xuICAgIGlmKHR5cGVvZiBjYiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpcy5saXN0ZW5lcnMucHVzaChjYik7XG4gICAgfVxuICB9XG5cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbiAgcGF1c2UoKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMudGltZXIpO1xuICB9XG5cbiAgcmVzdW1lKCkge1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIGVuZFRpbWVyKCkge1xuICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcbiAgICAgIHRoaXMubGlzdGVuZXJzLmxlbmd0aCA9IDA7XG4gICAgfVxuICB9XG5cbiAgZGlzcG9zZSgpIHtcbiAgICB0aGlzLmVuZFRpbWVyKCk7XG4gIH1cblxufSJdfQ==
