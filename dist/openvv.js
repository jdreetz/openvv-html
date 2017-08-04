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

// Main entry point
var OpenVV = function () {
  function OpenVV() {
    _classCallCheck(this, OpenVV);

    this.executors = [];
  }

  _createClass(OpenVV, [{
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyYy9FbnZpcm9ubWVudC9FbnZpcm9ubWVudC5qcyIsInNyYy9IZWxwZXJzL1ZhbGlkYXRvcnMuanMiLCJzcmMvTWVhc3VyZW1lbnQvRXZlbnRzLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3IuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2VUZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0Jhc2V0ZWNobmlxdWUuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzL0ludGVyc2VjdGlvbk9ic2VydmVyLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9pbmRleC5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL09wZW5WVi5qcyIsInNyYy9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEuanMiLCJzcmMvVGltaW5nL0luVmlld1RpbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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UCxLQUFjLFVBQWpCLEVBQTZCO0FBQzNCLGFBQUssU0FBTCxDQUFlLElBQWYsQ0FBb0IsRUFBcEI7QUFDRDtBQUNGOzs7NEJBRU87QUFDTixXQUFLLFFBQUw7QUFDQSxXQUFLLEtBQUwsR0FBYSxXQUFXLEtBQUssYUFBTCxDQUFtQixJQUFuQixDQUF3QixJQUF4QixDQUFYLEVBQTBDLEtBQUssUUFBL0MsQ0FBYjtBQUNEOzs7MkJBRU07QUFDTCxXQUFLLFFBQUw7QUFDRDs7OzRCQUVPO0FBQ04sbUJBQWEsS0FBSyxLQUFsQjtBQUNEOzs7NkJBRVE7QUFDUCxXQUFLLEtBQUwsR0FBYSxXQUFXLEtBQUssYUFBTCxDQUFtQixJQUFuQixDQUF3QixJQUF4QixDQUFYLEVBQTBDLEtBQUssUUFBL0MsQ0FBYjtBQUNEOzs7K0JBRVU7QUFDVCxVQUFHLEtBQUssS0FBUixFQUFlO0FBQ2IscUJBQWEsS0FBSyxLQUFsQjtBQUNBLGFBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsQ0FBeEI7QUFDRDtBQUNGOzs7OEJBRVM7QUFDUixXQUFLLFFBQUw7QUFDRDs7Ozs7O2tCQTVDa0IsVyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKipcbiAqIENvcHlyaWdodCAyMDE2IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbihmdW5jdGlvbih3aW5kb3csIGRvY3VtZW50KSB7XG4ndXNlIHN0cmljdCc7XG5cblxuLy8gRXhpdHMgZWFybHkgaWYgYWxsIEludGVyc2VjdGlvbk9ic2VydmVyIGFuZCBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5XG4vLyBmZWF0dXJlcyBhcmUgbmF0aXZlbHkgc3VwcG9ydGVkLlxuaWYgKCdJbnRlcnNlY3Rpb25PYnNlcnZlcicgaW4gd2luZG93ICYmXG4gICAgJ0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnknIGluIHdpbmRvdyAmJlxuICAgICdpbnRlcnNlY3Rpb25SYXRpbycgaW4gd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyRW50cnkucHJvdG90eXBlKSB7XG4gIHJldHVybjtcbn1cblxuXG4vKipcbiAqIEFuIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5LiBUaGlzIHJlZ2lzdHJ5IGV4aXN0cyB0byBob2xkIGEgc3Ryb25nXG4gKiByZWZlcmVuY2UgdG8gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgaW5zdGFuY2VzIGN1cnJlbnRseSBvYnNlcnZlcmluZyBhIHRhcmdldFxuICogZWxlbWVudC4gV2l0aG91dCB0aGlzIHJlZ2lzdHJ5LCBpbnN0YW5jZXMgd2l0aG91dCBhbm90aGVyIHJlZmVyZW5jZSBtYXkgYmVcbiAqIGdhcmJhZ2UgY29sbGVjdGVkLlxuICovXG52YXIgcmVnaXN0cnkgPSBbXTtcblxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5IGNvbnN0cnVjdG9yLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jaW50ZXJzZWN0aW9uLW9ic2VydmVyLWVudHJ5XG4gKiBAcGFyYW0ge09iamVjdH0gZW50cnkgQSBkaWN0aW9uYXJ5IG9mIGluc3RhbmNlIHByb3BlcnRpZXMuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeShlbnRyeSkge1xuICB0aGlzLnRpbWUgPSBlbnRyeS50aW1lO1xuICB0aGlzLnRhcmdldCA9IGVudHJ5LnRhcmdldDtcbiAgdGhpcy5yb290Qm91bmRzID0gZW50cnkucm9vdEJvdW5kcztcbiAgdGhpcy5ib3VuZGluZ0NsaWVudFJlY3QgPSBlbnRyeS5ib3VuZGluZ0NsaWVudFJlY3Q7XG4gIHRoaXMuaW50ZXJzZWN0aW9uUmVjdCA9IGVudHJ5LmludGVyc2VjdGlvblJlY3QgfHwgZ2V0RW1wdHlSZWN0KCk7XG4gIHRoaXMuaXNJbnRlcnNlY3RpbmcgPSAhIWVudHJ5LmludGVyc2VjdGlvblJlY3Q7XG5cbiAgLy8gQ2FsY3VsYXRlcyB0aGUgaW50ZXJzZWN0aW9uIHJhdGlvLlxuICB2YXIgdGFyZ2V0UmVjdCA9IHRoaXMuYm91bmRpbmdDbGllbnRSZWN0O1xuICB2YXIgdGFyZ2V0QXJlYSA9IHRhcmdldFJlY3Qud2lkdGggKiB0YXJnZXRSZWN0LmhlaWdodDtcbiAgdmFyIGludGVyc2VjdGlvblJlY3QgPSB0aGlzLmludGVyc2VjdGlvblJlY3Q7XG4gIHZhciBpbnRlcnNlY3Rpb25BcmVhID0gaW50ZXJzZWN0aW9uUmVjdC53aWR0aCAqIGludGVyc2VjdGlvblJlY3QuaGVpZ2h0O1xuXG4gIC8vIFNldHMgaW50ZXJzZWN0aW9uIHJhdGlvLlxuICBpZiAodGFyZ2V0QXJlYSkge1xuICAgIHRoaXMuaW50ZXJzZWN0aW9uUmF0aW8gPSBpbnRlcnNlY3Rpb25BcmVhIC8gdGFyZ2V0QXJlYTtcbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBhcmVhIGlzIHplcm8gYW5kIGlzIGludGVyc2VjdGluZywgc2V0cyB0byAxLCBvdGhlcndpc2UgdG8gMFxuICAgIHRoaXMuaW50ZXJzZWN0aW9uUmF0aW8gPSB0aGlzLmlzSW50ZXJzZWN0aW5nID8gMSA6IDA7XG4gIH1cbn1cblxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciBjb25zdHJ1Y3Rvci5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2ludGVyc2VjdGlvbi1vYnNlcnZlci1pbnRlcmZhY2VcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGNhbGxiYWNrIFRoZSBmdW5jdGlvbiB0byBiZSBpbnZva2VkIGFmdGVyIGludGVyc2VjdGlvblxuICogICAgIGNoYW5nZXMgaGF2ZSBxdWV1ZWQuIFRoZSBmdW5jdGlvbiBpcyBub3QgaW52b2tlZCBpZiB0aGUgcXVldWUgaGFzXG4gKiAgICAgYmVlbiBlbXB0aWVkIGJ5IGNhbGxpbmcgdGhlIGB0YWtlUmVjb3Jkc2AgbWV0aG9kLlxuICogQHBhcmFtIHtPYmplY3Q9fSBvcHRfb3B0aW9ucyBPcHRpb25hbCBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gKiBAY29uc3RydWN0b3JcbiAqL1xuZnVuY3Rpb24gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIoY2FsbGJhY2ssIG9wdF9vcHRpb25zKSB7XG5cbiAgdmFyIG9wdGlvbnMgPSBvcHRfb3B0aW9ucyB8fCB7fTtcblxuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG5cbiAgaWYgKG9wdGlvbnMucm9vdCAmJiBvcHRpb25zLnJvb3Qubm9kZVR5cGUgIT0gMSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncm9vdCBtdXN0IGJlIGFuIEVsZW1lbnQnKTtcbiAgfVxuXG4gIC8vIEJpbmRzIGFuZCB0aHJvdHRsZXMgYHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9uc2AuXG4gIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyA9IHRocm90dGxlKFxuICAgICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLmJpbmQodGhpcyksIHRoaXMuVEhST1RUTEVfVElNRU9VVCk7XG5cbiAgLy8gUHJpdmF0ZSBwcm9wZXJ0aWVzLlxuICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPSBbXTtcbiAgdGhpcy5fcXVldWVkRW50cmllcyA9IFtdO1xuICB0aGlzLl9yb290TWFyZ2luVmFsdWVzID0gdGhpcy5fcGFyc2VSb290TWFyZ2luKG9wdGlvbnMucm9vdE1hcmdpbik7XG5cbiAgLy8gUHVibGljIHByb3BlcnRpZXMuXG4gIHRoaXMudGhyZXNob2xkcyA9IHRoaXMuX2luaXRUaHJlc2hvbGRzKG9wdGlvbnMudGhyZXNob2xkKTtcbiAgdGhpcy5yb290ID0gb3B0aW9ucy5yb290IHx8IG51bGw7XG4gIHRoaXMucm9vdE1hcmdpbiA9IHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMubWFwKGZ1bmN0aW9uKG1hcmdpbikge1xuICAgIHJldHVybiBtYXJnaW4udmFsdWUgKyBtYXJnaW4udW5pdDtcbiAgfSkuam9pbignICcpO1xufVxuXG5cbi8qKlxuICogVGhlIG1pbmltdW0gaW50ZXJ2YWwgd2l0aGluIHdoaWNoIHRoZSBkb2N1bWVudCB3aWxsIGJlIGNoZWNrZWQgZm9yXG4gKiBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlRIUk9UVExFX1RJTUVPVVQgPSAxMDA7XG5cblxuLyoqXG4gKiBUaGUgZnJlcXVlbmN5IGluIHdoaWNoIHRoZSBwb2x5ZmlsbCBwb2xscyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiB0aGlzIGNhbiBiZSB1cGRhdGVkIG9uIGEgcGVyIGluc3RhbmNlIGJhc2lzIGFuZCBtdXN0IGJlIHNldCBwcmlvciB0b1xuICogY2FsbGluZyBgb2JzZXJ2ZWAgb24gdGhlIGZpcnN0IHRhcmdldC5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlBPTExfSU5URVJWQUwgPSBudWxsO1xuXG5cbi8qKlxuICogU3RhcnRzIG9ic2VydmluZyBhIHRhcmdldCBlbGVtZW50IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBiYXNlZCBvblxuICogdGhlIHRocmVzaG9sZHMgdmFsdWVzLlxuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIERPTSBlbGVtZW50IHRvIG9ic2VydmUuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5vYnNlcnZlID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIC8vIElmIHRoZSB0YXJnZXQgaXMgYWxyZWFkeSBiZWluZyBvYnNlcnZlZCwgZG8gbm90aGluZy5cbiAgaWYgKHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5zb21lKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5lbGVtZW50ID09IHRhcmdldDtcbiAgfSkpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoISh0YXJnZXQgJiYgdGFyZ2V0Lm5vZGVUeXBlID09IDEpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCd0YXJnZXQgbXVzdCBiZSBhbiBFbGVtZW50Jyk7XG4gIH1cblxuICB0aGlzLl9yZWdpc3Rlckluc3RhbmNlKCk7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5wdXNoKHtlbGVtZW50OiB0YXJnZXQsIGVudHJ5OiBudWxsfSk7XG4gIHRoaXMuX21vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG59O1xuXG5cbi8qKlxuICogU3RvcHMgb2JzZXJ2aW5nIGEgdGFyZ2V0IGVsZW1lbnQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICogQHBhcmFtIHtFbGVtZW50fSB0YXJnZXQgVGhlIERPTSBlbGVtZW50IHRvIG9ic2VydmUuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS51bm9ic2VydmUgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID1cbiAgICAgIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5maWx0ZXIoZnVuY3Rpb24oaXRlbSkge1xuXG4gICAgcmV0dXJuIGl0ZW0uZWxlbWVudCAhPSB0YXJnZXQ7XG4gIH0pO1xuICBpZiAoIXRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5sZW5ndGgpIHtcbiAgICB0aGlzLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG4gICAgdGhpcy5fdW5yZWdpc3Rlckluc3RhbmNlKCk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTdG9wcyBvYnNlcnZpbmcgYWxsIHRhcmdldCBlbGVtZW50cyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5kaXNjb25uZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9IFtdO1xuICB0aGlzLl91bm1vbml0b3JJbnRlcnNlY3Rpb25zKCk7XG4gIHRoaXMuX3VucmVnaXN0ZXJJbnN0YW5jZSgpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgYW55IHF1ZXVlIGVudHJpZXMgdGhhdCBoYXZlIG5vdCB5ZXQgYmVlbiByZXBvcnRlZCB0byB0aGVcbiAqIGNhbGxiYWNrIGFuZCBjbGVhcnMgdGhlIHF1ZXVlLiBUaGlzIGNhbiBiZSB1c2VkIGluIGNvbmp1bmN0aW9uIHdpdGggdGhlXG4gKiBjYWxsYmFjayB0byBvYnRhaW4gdGhlIGFic29sdXRlIG1vc3QgdXAtdG8tZGF0ZSBpbnRlcnNlY3Rpb24gaW5mb3JtYXRpb24uXG4gKiBAcmV0dXJuIHtBcnJheX0gVGhlIGN1cnJlbnRseSBxdWV1ZWQgZW50cmllcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLnRha2VSZWNvcmRzID0gZnVuY3Rpb24oKSB7XG4gIHZhciByZWNvcmRzID0gdGhpcy5fcXVldWVkRW50cmllcy5zbGljZSgpO1xuICB0aGlzLl9xdWV1ZWRFbnRyaWVzID0gW107XG4gIHJldHVybiByZWNvcmRzO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgdGhlIHRocmVzaG9sZCB2YWx1ZSBmcm9tIHRoZSB1c2VyIGNvbmZpZ3VyYXRpb24gb2JqZWN0IGFuZFxuICogcmV0dXJucyBhIHNvcnRlZCBhcnJheSBvZiB1bmlxdWUgdGhyZXNob2xkIHZhbHVlcy4gSWYgYSB2YWx1ZSBpcyBub3RcbiAqIGJldHdlZW4gMCBhbmQgMSBhbmQgZXJyb3IgaXMgdGhyb3duLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7QXJyYXl8bnVtYmVyPX0gb3B0X3RocmVzaG9sZCBBbiBvcHRpb25hbCB0aHJlc2hvbGQgdmFsdWUgb3JcbiAqICAgICBhIGxpc3Qgb2YgdGhyZXNob2xkIHZhbHVlcywgZGVmYXVsdGluZyB0byBbMF0uXG4gKiBAcmV0dXJuIHtBcnJheX0gQSBzb3J0ZWQgbGlzdCBvZiB1bmlxdWUgYW5kIHZhbGlkIHRocmVzaG9sZCB2YWx1ZXMuXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5faW5pdFRocmVzaG9sZHMgPSBmdW5jdGlvbihvcHRfdGhyZXNob2xkKSB7XG4gIHZhciB0aHJlc2hvbGQgPSBvcHRfdGhyZXNob2xkIHx8IFswXTtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHRocmVzaG9sZCkpIHRocmVzaG9sZCA9IFt0aHJlc2hvbGRdO1xuXG4gIHJldHVybiB0aHJlc2hvbGQuc29ydCgpLmZpbHRlcihmdW5jdGlvbih0LCBpLCBhKSB7XG4gICAgaWYgKHR5cGVvZiB0ICE9ICdudW1iZXInIHx8IGlzTmFOKHQpIHx8IHQgPCAwIHx8IHQgPiAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RocmVzaG9sZCBtdXN0IGJlIGEgbnVtYmVyIGJldHdlZW4gMCBhbmQgMSBpbmNsdXNpdmVseScpO1xuICAgIH1cbiAgICByZXR1cm4gdCAhPT0gYVtpIC0gMV07XG4gIH0pO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgdGhlIHJvb3RNYXJnaW4gdmFsdWUgZnJvbSB0aGUgdXNlciBjb25maWd1cmF0aW9uIG9iamVjdFxuICogYW5kIHJldHVybnMgYW4gYXJyYXkgb2YgdGhlIGZvdXIgbWFyZ2luIHZhbHVlcyBhcyBhbiBvYmplY3QgY29udGFpbmluZ1xuICogdGhlIHZhbHVlIGFuZCB1bml0IHByb3BlcnRpZXMuIElmIGFueSBvZiB0aGUgdmFsdWVzIGFyZSBub3QgcHJvcGVybHlcbiAqIGZvcm1hdHRlZCBvciB1c2UgYSB1bml0IG90aGVyIHRoYW4gcHggb3IgJSwgYW5kIGVycm9yIGlzIHRocm93bi5cbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge3N0cmluZz19IG9wdF9yb290TWFyZ2luIEFuIG9wdGlvbmFsIHJvb3RNYXJnaW4gdmFsdWUsXG4gKiAgICAgZGVmYXVsdGluZyB0byAnMHB4Jy5cbiAqIEByZXR1cm4ge0FycmF5PE9iamVjdD59IEFuIGFycmF5IG9mIG1hcmdpbiBvYmplY3RzIHdpdGggdGhlIGtleXNcbiAqICAgICB2YWx1ZSBhbmQgdW5pdC5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9wYXJzZVJvb3RNYXJnaW4gPSBmdW5jdGlvbihvcHRfcm9vdE1hcmdpbikge1xuICB2YXIgbWFyZ2luU3RyaW5nID0gb3B0X3Jvb3RNYXJnaW4gfHwgJzBweCc7XG4gIHZhciBtYXJnaW5zID0gbWFyZ2luU3RyaW5nLnNwbGl0KC9cXHMrLykubWFwKGZ1bmN0aW9uKG1hcmdpbikge1xuICAgIHZhciBwYXJ0cyA9IC9eKC0/XFxkKlxcLj9cXGQrKShweHwlKSQvLmV4ZWMobWFyZ2luKTtcbiAgICBpZiAoIXBhcnRzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ3Jvb3RNYXJnaW4gbXVzdCBiZSBzcGVjaWZpZWQgaW4gcGl4ZWxzIG9yIHBlcmNlbnQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHt2YWx1ZTogcGFyc2VGbG9hdChwYXJ0c1sxXSksIHVuaXQ6IHBhcnRzWzJdfTtcbiAgfSk7XG5cbiAgLy8gSGFuZGxlcyBzaG9ydGhhbmQuXG4gIG1hcmdpbnNbMV0gPSBtYXJnaW5zWzFdIHx8IG1hcmdpbnNbMF07XG4gIG1hcmdpbnNbMl0gPSBtYXJnaW5zWzJdIHx8IG1hcmdpbnNbMF07XG4gIG1hcmdpbnNbM10gPSBtYXJnaW5zWzNdIHx8IG1hcmdpbnNbMV07XG5cbiAgcmV0dXJuIG1hcmdpbnM7XG59O1xuXG5cbi8qKlxuICogU3RhcnRzIHBvbGxpbmcgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGlmIHRoZSBwb2xsaW5nIGlzIG5vdCBhbHJlYWR5XG4gKiBoYXBwZW5pbmcsIGFuZCBpZiB0aGUgcGFnZSdzIHZpc2liaWx0eSBzdGF0ZSBpcyB2aXNpYmxlLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9tb25pdG9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICBpZiAoIXRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zKSB7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMgPSB0cnVlO1xuXG4gICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zKCk7XG5cbiAgICAvLyBJZiBhIHBvbGwgaW50ZXJ2YWwgaXMgc2V0LCB1c2UgcG9sbGluZyBpbnN0ZWFkIG9mIGxpc3RlbmluZyB0b1xuICAgIC8vIHJlc2l6ZSBhbmQgc2Nyb2xsIGV2ZW50cyBvciBET00gbXV0YXRpb25zLlxuICAgIGlmICh0aGlzLlBPTExfSU5URVJWQUwpIHtcbiAgICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCA9IHNldEludGVydmFsKFxuICAgICAgICAgIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdGhpcy5QT0xMX0lOVEVSVkFMKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBhZGRFdmVudCh3aW5kb3csICdyZXNpemUnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuICAgICAgYWRkRXZlbnQoZG9jdW1lbnQsICdzY3JvbGwnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuXG4gICAgICBpZiAoJ011dGF0aW9uT2JzZXJ2ZXInIGluIHdpbmRvdykge1xuICAgICAgICB0aGlzLl9kb21PYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucyk7XG4gICAgICAgIHRoaXMuX2RvbU9ic2VydmVyLm9ic2VydmUoZG9jdW1lbnQsIHtcbiAgICAgICAgICBhdHRyaWJ1dGVzOiB0cnVlLFxuICAgICAgICAgIGNoaWxkTGlzdDogdHJ1ZSxcbiAgICAgICAgICBjaGFyYWN0ZXJEYXRhOiB0cnVlLFxuICAgICAgICAgIHN1YnRyZWU6IHRydWVcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogU3RvcHMgcG9sbGluZyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3VubW9uaXRvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuX21vbml0b3JpbmdJbnRlcnNlY3Rpb25zKSB7XG4gICAgdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMgPSBmYWxzZTtcblxuICAgIGNsZWFySW50ZXJ2YWwodGhpcy5fbW9uaXRvcmluZ0ludGVydmFsKTtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwgPSBudWxsO1xuXG4gICAgcmVtb3ZlRXZlbnQod2luZG93LCAncmVzaXplJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcbiAgICByZW1vdmVFdmVudChkb2N1bWVudCwgJ3Njcm9sbCcsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG5cbiAgICBpZiAodGhpcy5fZG9tT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuX2RvbU9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcbiAgICAgIHRoaXMuX2RvbU9ic2VydmVyID0gbnVsbDtcbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTY2FucyBlYWNoIG9ic2VydmF0aW9uIHRhcmdldCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgYW5kIGFkZHMgdGhlbVxuICogdG8gdGhlIGludGVybmFsIGVudHJpZXMgcXVldWUuIElmIG5ldyBlbnRyaWVzIGFyZSBmb3VuZCwgaXRcbiAqIHNjaGVkdWxlcyB0aGUgY2FsbGJhY2sgdG8gYmUgaW52b2tlZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIHZhciByb290SXNJbkRvbSA9IHRoaXMuX3Jvb3RJc0luRG9tKCk7XG4gIHZhciByb290UmVjdCA9IHJvb3RJc0luRG9tID8gdGhpcy5fZ2V0Um9vdFJlY3QoKSA6IGdldEVtcHR5UmVjdCgpO1xuXG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cy5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICB2YXIgdGFyZ2V0ID0gaXRlbS5lbGVtZW50O1xuICAgIHZhciB0YXJnZXRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRhcmdldCk7XG4gICAgdmFyIHJvb3RDb250YWluc1RhcmdldCA9IHRoaXMuX3Jvb3RDb250YWluc1RhcmdldCh0YXJnZXQpO1xuICAgIHZhciBvbGRFbnRyeSA9IGl0ZW0uZW50cnk7XG4gICAgdmFyIGludGVyc2VjdGlvblJlY3QgPSByb290SXNJbkRvbSAmJiByb290Q29udGFpbnNUYXJnZXQgJiZcbiAgICAgICAgdGhpcy5fY29tcHV0ZVRhcmdldEFuZFJvb3RJbnRlcnNlY3Rpb24odGFyZ2V0LCByb290UmVjdCk7XG5cbiAgICB2YXIgbmV3RW50cnkgPSBpdGVtLmVudHJ5ID0gbmV3IEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkoe1xuICAgICAgdGltZTogbm93KCksXG4gICAgICB0YXJnZXQ6IHRhcmdldCxcbiAgICAgIGJvdW5kaW5nQ2xpZW50UmVjdDogdGFyZ2V0UmVjdCxcbiAgICAgIHJvb3RCb3VuZHM6IHJvb3RSZWN0LFxuICAgICAgaW50ZXJzZWN0aW9uUmVjdDogaW50ZXJzZWN0aW9uUmVjdFxuICAgIH0pO1xuXG4gICAgaWYgKCFvbGRFbnRyeSkge1xuICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICB9IGVsc2UgaWYgKHJvb3RJc0luRG9tICYmIHJvb3RDb250YWluc1RhcmdldCkge1xuICAgICAgLy8gSWYgdGhlIG5ldyBlbnRyeSBpbnRlcnNlY3Rpb24gcmF0aW8gaGFzIGNyb3NzZWQgYW55IG9mIHRoZVxuICAgICAgLy8gdGhyZXNob2xkcywgYWRkIGEgbmV3IGVudHJ5LlxuICAgICAgaWYgKHRoaXMuX2hhc0Nyb3NzZWRUaHJlc2hvbGQob2xkRW50cnksIG5ld0VudHJ5KSkge1xuICAgICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB0aGUgcm9vdCBpcyBub3QgaW4gdGhlIERPTSBvciB0YXJnZXQgaXMgbm90IGNvbnRhaW5lZCB3aXRoaW5cbiAgICAgIC8vIHJvb3QgYnV0IHRoZSBwcmV2aW91cyBlbnRyeSBmb3IgdGhpcyB0YXJnZXQgaGFkIGFuIGludGVyc2VjdGlvbixcbiAgICAgIC8vIGFkZCBhIG5ldyByZWNvcmQgaW5kaWNhdGluZyByZW1vdmFsLlxuICAgICAgaWYgKG9sZEVudHJ5ICYmIG9sZEVudHJ5LmlzSW50ZXJzZWN0aW5nKSB7XG4gICAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgICB9XG4gICAgfVxuICB9LCB0aGlzKTtcblxuICBpZiAodGhpcy5fcXVldWVkRW50cmllcy5sZW5ndGgpIHtcbiAgICB0aGlzLl9jYWxsYmFjayh0aGlzLnRha2VSZWNvcmRzKCksIHRoaXMpO1xuICB9XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhIHRhcmdldCBhbmQgcm9vdCByZWN0IGNvbXB1dGVzIHRoZSBpbnRlcnNlY3Rpb24gYmV0d2VlbiB0aGVuXG4gKiBmb2xsb3dpbmcgdGhlIGFsZ29yaXRobSBpbiB0aGUgc3BlYy5cbiAqIFRPRE8ocGhpbGlwd2FsdG9uKTogYXQgdGhpcyB0aW1lIGNsaXAtcGF0aCBpcyBub3QgY29uc2lkZXJlZC5cbiAqIGh0dHBzOi8vd2ljZy5naXRodWIuaW8vSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvI2NhbGN1bGF0ZS1pbnRlcnNlY3Rpb24tcmVjdC1hbGdvXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgdGFyZ2V0IERPTSBlbGVtZW50XG4gKiBAcGFyYW0ge09iamVjdH0gcm9vdFJlY3QgVGhlIGJvdW5kaW5nIHJlY3Qgb2YgdGhlIHJvb3QgYWZ0ZXIgYmVpbmdcbiAqICAgICBleHBhbmRlZCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEByZXR1cm4gez9PYmplY3R9IFRoZSBmaW5hbCBpbnRlcnNlY3Rpb24gcmVjdCBvYmplY3Qgb3IgdW5kZWZpbmVkIGlmIG5vXG4gKiAgICAgaW50ZXJzZWN0aW9uIGlzIGZvdW5kLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9jb21wdXRlVGFyZ2V0QW5kUm9vdEludGVyc2VjdGlvbiA9XG4gICAgZnVuY3Rpb24odGFyZ2V0LCByb290UmVjdCkge1xuXG4gIC8vIElmIHRoZSBlbGVtZW50IGlzbid0IGRpc3BsYXllZCwgYW4gaW50ZXJzZWN0aW9uIGNhbid0IGhhcHBlbi5cbiAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRhcmdldCkuZGlzcGxheSA9PSAnbm9uZScpIHJldHVybjtcblxuICB2YXIgdGFyZ2V0UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdCh0YXJnZXQpO1xuICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHRhcmdldFJlY3Q7XG4gIHZhciBwYXJlbnQgPSBnZXRQYXJlbnROb2RlKHRhcmdldCk7XG4gIHZhciBhdFJvb3QgPSBmYWxzZTtcblxuICB3aGlsZSAoIWF0Um9vdCkge1xuICAgIHZhciBwYXJlbnRSZWN0ID0gbnVsbDtcbiAgICB2YXIgcGFyZW50Q29tcHV0ZWRTdHlsZSA9IHBhcmVudC5ub2RlVHlwZSA9PSAxID9cbiAgICAgICAgd2luZG93LmdldENvbXB1dGVkU3R5bGUocGFyZW50KSA6IHt9O1xuXG4gICAgLy8gSWYgdGhlIHBhcmVudCBpc24ndCBkaXNwbGF5ZWQsIGFuIGludGVyc2VjdGlvbiBjYW4ndCBoYXBwZW4uXG4gICAgaWYgKHBhcmVudENvbXB1dGVkU3R5bGUuZGlzcGxheSA9PSAnbm9uZScpIHJldHVybjtcblxuICAgIGlmIChwYXJlbnQgPT0gdGhpcy5yb290IHx8IHBhcmVudCA9PSBkb2N1bWVudCkge1xuICAgICAgYXRSb290ID0gdHJ1ZTtcbiAgICAgIHBhcmVudFJlY3QgPSByb290UmVjdDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgdGhlIGVsZW1lbnQgaGFzIGEgbm9uLXZpc2libGUgb3ZlcmZsb3csIGFuZCBpdCdzIG5vdCB0aGUgPGJvZHk+XG4gICAgICAvLyBvciA8aHRtbD4gZWxlbWVudCwgdXBkYXRlIHRoZSBpbnRlcnNlY3Rpb24gcmVjdC5cbiAgICAgIC8vIE5vdGU6IDxib2R5PiBhbmQgPGh0bWw+IGNhbm5vdCBiZSBjbGlwcGVkIHRvIGEgcmVjdCB0aGF0J3Mgbm90IGFsc29cbiAgICAgIC8vIHRoZSBkb2N1bWVudCByZWN0LCBzbyBubyBuZWVkIHRvIGNvbXB1dGUgYSBuZXcgaW50ZXJzZWN0aW9uLlxuICAgICAgaWYgKHBhcmVudCAhPSBkb2N1bWVudC5ib2R5ICYmXG4gICAgICAgICAgcGFyZW50ICE9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudCAmJlxuICAgICAgICAgIHBhcmVudENvbXB1dGVkU3R5bGUub3ZlcmZsb3cgIT0gJ3Zpc2libGUnKSB7XG4gICAgICAgIHBhcmVudFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QocGFyZW50KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiBlaXRoZXIgb2YgdGhlIGFib3ZlIGNvbmRpdGlvbmFscyBzZXQgYSBuZXcgcGFyZW50UmVjdCxcbiAgICAvLyBjYWxjdWxhdGUgbmV3IGludGVyc2VjdGlvbiBkYXRhLlxuICAgIGlmIChwYXJlbnRSZWN0KSB7XG4gICAgICBpbnRlcnNlY3Rpb25SZWN0ID0gY29tcHV0ZVJlY3RJbnRlcnNlY3Rpb24ocGFyZW50UmVjdCwgaW50ZXJzZWN0aW9uUmVjdCk7XG5cbiAgICAgIGlmICghaW50ZXJzZWN0aW9uUmVjdCkgYnJlYWs7XG4gICAgfVxuICAgIHBhcmVudCA9IGdldFBhcmVudE5vZGUocGFyZW50KTtcbiAgfVxuICByZXR1cm4gaW50ZXJzZWN0aW9uUmVjdDtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByb290IHJlY3QgYWZ0ZXIgYmVpbmcgZXhwYW5kZWQgYnkgdGhlIHJvb3RNYXJnaW4gdmFsdWUuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByb290IHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2dldFJvb3RSZWN0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciByb290UmVjdDtcbiAgaWYgKHRoaXMucm9vdCkge1xuICAgIHJvb3RSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRoaXMucm9vdCk7XG4gIH0gZWxzZSB7XG4gICAgLy8gVXNlIDxodG1sPi88Ym9keT4gaW5zdGVhZCBvZiB3aW5kb3cgc2luY2Ugc2Nyb2xsIGJhcnMgYWZmZWN0IHNpemUuXG4gICAgdmFyIGh0bWwgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgdmFyIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuICAgIHJvb3RSZWN0ID0ge1xuICAgICAgdG9wOiAwLFxuICAgICAgbGVmdDogMCxcbiAgICAgIHJpZ2h0OiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICB3aWR0aDogaHRtbC5jbGllbnRXaWR0aCB8fCBib2R5LmNsaWVudFdpZHRoLFxuICAgICAgYm90dG9tOiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodCxcbiAgICAgIGhlaWdodDogaHRtbC5jbGllbnRIZWlnaHQgfHwgYm9keS5jbGllbnRIZWlnaHRcbiAgICB9O1xuICB9XG4gIHJldHVybiB0aGlzLl9leHBhbmRSZWN0QnlSb290TWFyZ2luKHJvb3RSZWN0KTtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgcmVjdCBhbmQgZXhwYW5kcyBpdCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0IFRoZSByZWN0IG9iamVjdCB0byBleHBhbmQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBleHBhbmRlZCByZWN0LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9leHBhbmRSZWN0QnlSb290TWFyZ2luID0gZnVuY3Rpb24ocmVjdCkge1xuICB2YXIgbWFyZ2lucyA9IHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMubWFwKGZ1bmN0aW9uKG1hcmdpbiwgaSkge1xuICAgIHJldHVybiBtYXJnaW4udW5pdCA9PSAncHgnID8gbWFyZ2luLnZhbHVlIDpcbiAgICAgICAgbWFyZ2luLnZhbHVlICogKGkgJSAyID8gcmVjdC53aWR0aCA6IHJlY3QuaGVpZ2h0KSAvIDEwMDtcbiAgfSk7XG4gIHZhciBuZXdSZWN0ID0ge1xuICAgIHRvcDogcmVjdC50b3AgLSBtYXJnaW5zWzBdLFxuICAgIHJpZ2h0OiByZWN0LnJpZ2h0ICsgbWFyZ2luc1sxXSxcbiAgICBib3R0b206IHJlY3QuYm90dG9tICsgbWFyZ2luc1syXSxcbiAgICBsZWZ0OiByZWN0LmxlZnQgLSBtYXJnaW5zWzNdXG4gIH07XG4gIG5ld1JlY3Qud2lkdGggPSBuZXdSZWN0LnJpZ2h0IC0gbmV3UmVjdC5sZWZ0O1xuICBuZXdSZWN0LmhlaWdodCA9IG5ld1JlY3QuYm90dG9tIC0gbmV3UmVjdC50b3A7XG5cbiAgcmV0dXJuIG5ld1JlY3Q7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyBhbiBvbGQgYW5kIG5ldyBlbnRyeSBhbmQgcmV0dXJucyB0cnVlIGlmIGF0IGxlYXN0IG9uZSBvZiB0aGVcbiAqIHRocmVzaG9sZCB2YWx1ZXMgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwYXJhbSB7P0ludGVyc2VjdGlvbk9ic2VydmVyRW50cnl9IG9sZEVudHJ5IFRoZSBwcmV2aW91cyBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudCBvciBudWxsIGlmIG5vIHByZXZpb3VzIGVudHJ5IGV4aXN0cy5cbiAqIEBwYXJhbSB7SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gbmV3RW50cnkgVGhlIGN1cnJlbnQgZW50cnkgZm9yIGFcbiAqICAgIHBhcnRpY3VsYXIgdGFyZ2V0IGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBSZXR1cm5zIHRydWUgaWYgYSBhbnkgdGhyZXNob2xkIGhhcyBiZWVuIGNyb3NzZWQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2hhc0Nyb3NzZWRUaHJlc2hvbGQgPVxuICAgIGZ1bmN0aW9uKG9sZEVudHJ5LCBuZXdFbnRyeSkge1xuXG4gIC8vIFRvIG1ha2UgY29tcGFyaW5nIGVhc2llciwgYW4gZW50cnkgdGhhdCBoYXMgYSByYXRpbyBvZiAwXG4gIC8vIGJ1dCBkb2VzIG5vdCBhY3R1YWxseSBpbnRlcnNlY3QgaXMgZ2l2ZW4gYSB2YWx1ZSBvZiAtMVxuICB2YXIgb2xkUmF0aW8gPSBvbGRFbnRyeSAmJiBvbGRFbnRyeS5pc0ludGVyc2VjdGluZyA/XG4gICAgICBvbGRFbnRyeS5pbnRlcnNlY3Rpb25SYXRpbyB8fCAwIDogLTE7XG4gIHZhciBuZXdSYXRpbyA9IG5ld0VudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG5ld0VudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcblxuICAvLyBJZ25vcmUgdW5jaGFuZ2VkIHJhdGlvc1xuICBpZiAob2xkUmF0aW8gPT09IG5ld1JhdGlvKSByZXR1cm47XG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLnRocmVzaG9sZHMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdGhyZXNob2xkID0gdGhpcy50aHJlc2hvbGRzW2ldO1xuXG4gICAgLy8gUmV0dXJuIHRydWUgaWYgYW4gZW50cnkgbWF0Y2hlcyBhIHRocmVzaG9sZCBvciBpZiB0aGUgbmV3IHJhdGlvXG4gICAgLy8gYW5kIHRoZSBvbGQgcmF0aW8gYXJlIG9uIHRoZSBvcHBvc2l0ZSBzaWRlcyBvZiBhIHRocmVzaG9sZC5cbiAgICBpZiAodGhyZXNob2xkID09IG9sZFJhdGlvIHx8IHRocmVzaG9sZCA9PSBuZXdSYXRpbyB8fFxuICAgICAgICB0aHJlc2hvbGQgPCBvbGRSYXRpbyAhPT0gdGhyZXNob2xkIDwgbmV3UmF0aW8pIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHJvb3QgZWxlbWVudCBpcyBhbiBlbGVtZW50IGFuZCBpcyBpbiB0aGUgRE9NLlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RJc0luRG9tID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiAhdGhpcy5yb290IHx8IGNvbnRhaW5zRGVlcChkb2N1bWVudCwgdGhpcy5yb290KTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHdoZXRoZXIgb3Igbm90IHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgdGFyZ2V0IGVsZW1lbnQgdG8gY2hlY2suXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSB0YXJnZXQgZWxlbWVudCBpcyBhIGNoaWxkIG9mIHJvb3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3Jvb3RDb250YWluc1RhcmdldCA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICByZXR1cm4gY29udGFpbnNEZWVwKHRoaXMucm9vdCB8fCBkb2N1bWVudCwgdGFyZ2V0KTtcbn07XG5cblxuLyoqXG4gKiBBZGRzIHRoZSBpbnN0YW5jZSB0byB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5IGlmIGl0IGlzbid0XG4gKiBhbHJlYWR5IHByZXNlbnQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3JlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHJlZ2lzdHJ5LmluZGV4T2YodGhpcykgPCAwKSB7XG4gICAgcmVnaXN0cnkucHVzaCh0aGlzKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFJlbW92ZXMgdGhlIGluc3RhbmNlIGZyb20gdGhlIGdsb2JhbCBJbnRlcnNlY3Rpb25PYnNlcnZlciByZWdpc3RyeS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5yZWdpc3Rlckluc3RhbmNlID0gZnVuY3Rpb24oKSB7XG4gIHZhciBpbmRleCA9IHJlZ2lzdHJ5LmluZGV4T2YodGhpcyk7XG4gIGlmIChpbmRleCAhPSAtMSkgcmVnaXN0cnkuc3BsaWNlKGluZGV4LCAxKTtcbn07XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByZXN1bHQgb2YgdGhlIHBlcmZvcm1hbmNlLm5vdygpIG1ldGhvZCBvciBudWxsIGluIGJyb3dzZXJzXG4gKiB0aGF0IGRvbid0IHN1cHBvcnQgdGhlIEFQSS5cbiAqIEByZXR1cm4ge251bWJlcn0gVGhlIGVsYXBzZWQgdGltZSBzaW5jZSB0aGUgcGFnZSB3YXMgcmVxdWVzdGVkLlxuICovXG5mdW5jdGlvbiBub3coKSB7XG4gIHJldHVybiB3aW5kb3cucGVyZm9ybWFuY2UgJiYgcGVyZm9ybWFuY2Uubm93ICYmIHBlcmZvcm1hbmNlLm5vdygpO1xufVxuXG5cbi8qKlxuICogVGhyb3R0bGVzIGEgZnVuY3Rpb24gYW5kIGRlbGF5cyBpdHMgZXhlY3V0aW9uZywgc28gaXQncyBvbmx5IGNhbGxlZCBhdCBtb3N0XG4gKiBvbmNlIHdpdGhpbiBhIGdpdmVuIHRpbWUgcGVyaW9kLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGZ1bmN0aW9uIHRvIHRocm90dGxlLlxuICogQHBhcmFtIHtudW1iZXJ9IHRpbWVvdXQgVGhlIGFtb3VudCBvZiB0aW1lIHRoYXQgbXVzdCBwYXNzIGJlZm9yZSB0aGVcbiAqICAgICBmdW5jdGlvbiBjYW4gYmUgY2FsbGVkIGFnYWluLlxuICogQHJldHVybiB7RnVuY3Rpb259IFRoZSB0aHJvdHRsZWQgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHRocm90dGxlKGZuLCB0aW1lb3V0KSB7XG4gIHZhciB0aW1lciA9IG51bGw7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKCF0aW1lcikge1xuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBmbigpO1xuICAgICAgICB0aW1lciA9IG51bGw7XG4gICAgICB9LCB0aW1lb3V0KTtcbiAgICB9XG4gIH07XG59XG5cblxuLyoqXG4gKiBBZGRzIGFuIGV2ZW50IGhhbmRsZXIgdG8gYSBET00gbm9kZSBlbnN1cmluZyBjcm9zcy1icm93c2VyIGNvbXBhdGliaWxpdHkuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIGFkZCB0aGUgZXZlbnQgaGFuZGxlciB0by5cbiAqIEBwYXJhbSB7c3RyaW5nfSBldmVudCBUaGUgZXZlbnQgbmFtZS5cbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBldmVudCBoYW5kbGVyIHRvIGFkZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gb3B0X3VzZUNhcHR1cmUgT3B0aW9uYWxseSBhZGRzIHRoZSBldmVuIHRvIHRoZSBjYXB0dXJlXG4gKiAgICAgcGhhc2UuIE5vdGU6IHRoaXMgb25seSB3b3JrcyBpbiBtb2Rlcm4gYnJvd3NlcnMuXG4gKi9cbmZ1bmN0aW9uIGFkZEV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLmFkZEV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5hdHRhY2hFdmVudCA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hdHRhY2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmVtb3ZlcyBhIHByZXZpb3VzbHkgYWRkZWQgZXZlbnQgaGFuZGxlciBmcm9tIGEgRE9NIG5vZGUuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIERPTSBub2RlIHRvIHJlbW92ZSB0aGUgZXZlbnQgaGFuZGxlciBmcm9tLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gcmVtb3ZlLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBJZiB0aGUgZXZlbnQgaGFuZGxlciB3YXMgYWRkZWQgd2l0aCB0aGlzXG4gKiAgICAgZmxhZyBzZXQgdG8gdHJ1ZSwgaXQgc2hvdWxkIGJlIHNldCB0byB0cnVlIGhlcmUgaW4gb3JkZXIgdG8gcmVtb3ZlIGl0LlxuICovXG5mdW5jdGlvbiByZW1vdmVFdmVudChub2RlLCBldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlKSB7XG4gIGlmICh0eXBlb2Ygbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSB8fCBmYWxzZSk7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIG5vZGUuZGV0YXRjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmRldGF0Y2hFdmVudCgnb24nICsgZXZlbnQsIGZuKTtcbiAgfVxufVxuXG5cbi8qKlxuICogUmV0dXJucyB0aGUgaW50ZXJzZWN0aW9uIGJldHdlZW4gdHdvIHJlY3Qgb2JqZWN0cy5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MSBUaGUgZmlyc3QgcmVjdC5cbiAqIEBwYXJhbSB7T2JqZWN0fSByZWN0MiBUaGUgc2Vjb25kIHJlY3QuXG4gKiBAcmV0dXJuIHs/T2JqZWN0fSBUaGUgaW50ZXJzZWN0aW9uIHJlY3Qgb3IgdW5kZWZpbmVkIGlmIG5vIGludGVyc2VjdGlvblxuICogICAgIGlzIGZvdW5kLlxuICovXG5mdW5jdGlvbiBjb21wdXRlUmVjdEludGVyc2VjdGlvbihyZWN0MSwgcmVjdDIpIHtcbiAgdmFyIHRvcCA9IE1hdGgubWF4KHJlY3QxLnRvcCwgcmVjdDIudG9wKTtcbiAgdmFyIGJvdHRvbSA9IE1hdGgubWluKHJlY3QxLmJvdHRvbSwgcmVjdDIuYm90dG9tKTtcbiAgdmFyIGxlZnQgPSBNYXRoLm1heChyZWN0MS5sZWZ0LCByZWN0Mi5sZWZ0KTtcbiAgdmFyIHJpZ2h0ID0gTWF0aC5taW4ocmVjdDEucmlnaHQsIHJlY3QyLnJpZ2h0KTtcbiAgdmFyIHdpZHRoID0gcmlnaHQgLSBsZWZ0O1xuICB2YXIgaGVpZ2h0ID0gYm90dG9tIC0gdG9wO1xuXG4gIHJldHVybiAod2lkdGggPj0gMCAmJiBoZWlnaHQgPj0gMCkgJiYge1xuICAgIHRvcDogdG9wLFxuICAgIGJvdHRvbTogYm90dG9tLFxuICAgIGxlZnQ6IGxlZnQsXG4gICAgcmlnaHQ6IHJpZ2h0LFxuICAgIHdpZHRoOiB3aWR0aCxcbiAgICBoZWlnaHQ6IGhlaWdodFxuICB9O1xufVxuXG5cbi8qKlxuICogU2hpbXMgdGhlIG5hdGl2ZSBnZXRCb3VuZGluZ0NsaWVudFJlY3QgZm9yIGNvbXBhdGliaWxpdHkgd2l0aCBvbGRlciBJRS5cbiAqIEBwYXJhbSB7RWxlbWVudH0gZWwgVGhlIGVsZW1lbnQgd2hvc2UgYm91bmRpbmcgcmVjdCB0byBnZXQuXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSAocG9zc2libHkgc2hpbW1lZCkgcmVjdCBvZiB0aGUgZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KGVsKSB7XG4gIHZhciByZWN0O1xuXG4gIHRyeSB7XG4gICAgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBJZ25vcmUgV2luZG93cyA3IElFMTEgXCJVbnNwZWNpZmllZCBlcnJvclwiXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL1dJQ0cvSW50ZXJzZWN0aW9uT2JzZXJ2ZXIvcHVsbC8yMDVcbiAgfVxuXG4gIGlmICghcmVjdCkgcmV0dXJuIGdldEVtcHR5UmVjdCgpO1xuXG4gIC8vIE9sZGVyIElFXG4gIGlmICghKHJlY3Qud2lkdGggJiYgcmVjdC5oZWlnaHQpKSB7XG4gICAgcmVjdCA9IHtcbiAgICAgIHRvcDogcmVjdC50b3AsXG4gICAgICByaWdodDogcmVjdC5yaWdodCxcbiAgICAgIGJvdHRvbTogcmVjdC5ib3R0b20sXG4gICAgICBsZWZ0OiByZWN0LmxlZnQsXG4gICAgICB3aWR0aDogcmVjdC5yaWdodCAtIHJlY3QubGVmdCxcbiAgICAgIGhlaWdodDogcmVjdC5ib3R0b20gLSByZWN0LnRvcFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHJlY3Q7XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIGFuIGVtcHR5IHJlY3Qgb2JqZWN0LiBBbiBlbXB0eSByZWN0IGlzIHJldHVybmVkIHdoZW4gYW4gZWxlbWVudFxuICogaXMgbm90IGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtPYmplY3R9IFRoZSBlbXB0eSByZWN0LlxuICovXG5mdW5jdGlvbiBnZXRFbXB0eVJlY3QoKSB7XG4gIHJldHVybiB7XG4gICAgdG9wOiAwLFxuICAgIGJvdHRvbTogMCxcbiAgICBsZWZ0OiAwLFxuICAgIHJpZ2h0OiAwLFxuICAgIHdpZHRoOiAwLFxuICAgIGhlaWdodDogMFxuICB9O1xufVxuXG4vKipcbiAqIENoZWNrcyB0byBzZWUgaWYgYSBwYXJlbnQgZWxlbWVudCBjb250YWlucyBhIGNoaWxkIGVsZW1udCAoaW5jbHVkaW5nIGluc2lkZVxuICogc2hhZG93IERPTSkuXG4gKiBAcGFyYW0ge05vZGV9IHBhcmVudCBUaGUgcGFyZW50IGVsZW1lbnQuXG4gKiBAcGFyYW0ge05vZGV9IGNoaWxkIFRoZSBjaGlsZCBlbGVtZW50LlxuICogQHJldHVybiB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGFyZW50IG5vZGUgY29udGFpbnMgdGhlIGNoaWxkIG5vZGUuXG4gKi9cbmZ1bmN0aW9uIGNvbnRhaW5zRGVlcChwYXJlbnQsIGNoaWxkKSB7XG4gIHZhciBub2RlID0gY2hpbGQ7XG4gIHdoaWxlIChub2RlKSB7XG4gICAgaWYgKG5vZGUgPT0gcGFyZW50KSByZXR1cm4gdHJ1ZTtcblxuICAgIG5vZGUgPSBnZXRQYXJlbnROb2RlKG5vZGUpO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuXG4vKipcbiAqIEdldHMgdGhlIHBhcmVudCBub2RlIG9mIGFuIGVsZW1lbnQgb3IgaXRzIGhvc3QgZWxlbWVudCBpZiB0aGUgcGFyZW50IG5vZGVcbiAqIGlzIGEgc2hhZG93IHJvb3QuXG4gKiBAcGFyYW0ge05vZGV9IG5vZGUgVGhlIG5vZGUgd2hvc2UgcGFyZW50IHRvIGdldC5cbiAqIEByZXR1cm4ge05vZGV8bnVsbH0gVGhlIHBhcmVudCBub2RlIG9yIG51bGwgaWYgbm8gcGFyZW50IGV4aXN0cy5cbiAqL1xuZnVuY3Rpb24gZ2V0UGFyZW50Tm9kZShub2RlKSB7XG4gIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG5cbiAgaWYgKHBhcmVudCAmJiBwYXJlbnQubm9kZVR5cGUgPT0gMTEgJiYgcGFyZW50Lmhvc3QpIHtcbiAgICAvLyBJZiB0aGUgcGFyZW50IGlzIGEgc2hhZG93IHJvb3QsIHJldHVybiB0aGUgaG9zdCBlbGVtZW50LlxuICAgIHJldHVybiBwYXJlbnQuaG9zdDtcbiAgfVxuICByZXR1cm4gcGFyZW50O1xufVxuXG5cbi8vIEV4cG9zZXMgdGhlIGNvbnN0cnVjdG9ycyBnbG9iYWxseS5cbndpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlciA9IEludGVyc2VjdGlvbk9ic2VydmVyO1xud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgPSBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5O1xuXG59KHdpbmRvdywgZG9jdW1lbnQpKTtcbiIsImV4cG9ydCBjb25zdCBnZXREZXRhaWxzID0gKGVsZW1lbnQpID0+IHtcbiAgcmV0dXJuIHtcbiAgICB2aWV3cG9ydFdpZHRoOiBNYXRoLm1heChkb2N1bWVudC5ib2R5LmNsaWVudFdpZHRoLCB3aW5kb3cuaW5uZXJXaWR0aCksXG4gICAgdmlld3BvcnRIZWlnaHQ6IE1hdGgubWF4KGRvY3VtZW50LmJvZHkuY2xpZW50SGVpZ2h0LCB3aW5kb3cuaW5uZXJIZWlnaHQpLFxuICAgIGVsZW1lbnRXaWR0aDogZWxlbWVudC5jbGllbnRXaWR0aCxcbiAgICBlbGVtZW50SGVpZ2h0OiBlbGVtZW50LmNsaWVudEhlaWdodCxcbiAgICBpZnJhbWVDb250ZXh0OiBpRnJhbWVDb250ZXh0KCksXG4gICAgZm9jdXM6IGlzSW5Gb2N1cygpXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGlzSW5Gb2N1cyA9ICgpID0+IHtcbiAgaWYgKGRvY3VtZW50LmhpZGRlbiAhPT0gJ3VuZGVmaW5lZCcpe1xuICAgIGlmIChkb2N1bWVudC5oaWRkZW4gPT09IHRydWUpe1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmKGlGcmFtZUNvbnRleHQoKSA9PT0gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZih3aW5kb3cuZG9jdW1lbnQuaGFzRm9jdXMpIHtcbiAgICByZXR1cm4gd2luZG93LnRvcC5kb2N1bWVudC5oYXNGb2N1cygpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBjb25zdCBpRnJhbWVDb250ZXh0ID0gKCkgPT4ge1xuICB0cnkge1xuICAgIGlmKHdpbmRvdy50b3AgPT09IHdpbmRvdykge1xuICAgICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuT05fUEFHRVxuICAgIH1cblxuICAgIGxldCBjdXJXaW4gPSB3aW5kb3csIGxldmVsID0gMDtcbiAgICB3aGlsZShjdXJXaW4ucGFyZW50ICE9PSBjdXJXaW4gJiYgbGV2ZWwgPCAxMDAwKSB7XG4gICAgICBpZihjdXJXaW4ucGFyZW50LmRvY3VtZW50LmRvbWFpbiAhPT0gY3VyV2luLmRvY3VtZW50LmRvbWFpbikge1xuICAgICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FO1xuICAgICAgfVxuXG4gICAgICBjdXJXaW4gPSBjdXJXaW4ucGFyZW50O1xuICAgIH1cbiAgICBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLlNBTUVfRE9NQUlOX0lGUkFNRTtcbiAgfVxuICBjYXRjaChlKSB7XG4gICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zID0ge1xuICBPTl9QQUdFOiAnb24gcGFnZScsXG4gIFNBTUVfRE9NQUlOX0lGUkFNRTogJ3NhbWUgZG9tYWluIGlmcmFtZScsXG4gIENST1NTX0RPTUFJTl9JRlJBTUU6ICdjcm9zcyBkb21haW4gaWZyYW1lJ1xufSIsImltcG9ydCBCYXNlVGVjaG5pcXVlIGZyb20gJy4uL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGVjaG5pcXVlcy9CYXNlVGVjaG5pcXVlJztcblxuLy8gZW5zdXJlIHRlY2huaXF1ZSBhdGxlYXN0IGhhcyB0aGUgc2FtZSBwcm9wZXJ0aWVzIGFuZCBtZXRob2RzIG9mIEFic3RyYWN0VGltZXJcbmV4cG9ydCBjb25zdCB2YWxpZFRlY2huaXF1ZSA9ICh0ZWNobmlxdWUpID0+IHtcbiAgY29uc3QgdmFsaWQgPSBcbiAgICB0eXBlb2YgdGVjaG5pcXVlID09PSAnZnVuY3Rpb24nICYmXG4gICAgT2JqZWN0XG4gICAgICAuZ2V0T3duUHJvcGVydHlOYW1lcyhCYXNlVGVjaG5pcXVlKVxuICAgICAgLnJlZHVjZSggKHByb3AsIHZhbGlkKSA9PiB2YWxpZCAmJiB0eXBlb2YgdGVjaG5pcXVlW3Byb3BdID09PSB0eXBlb2YgQmFzZVRlY2huaXF1ZVtwcm9wXSwgdHJ1ZSk7XG5cbiAgcmV0dXJuIHZhbGlkO1xufTtcblxuZXhwb3J0IGNvbnN0IHZhbGlkRWxlbWVudCA9IChlbGVtZW50KSA9PiB7XG4gIHJldHVybiBlbGVtZW50ICYmIGVsZW1lbnQudG9TdHJpbmcoKS5pbmRleE9mKCdFbGVtZW50JykgPiAtMTtcbn07XG5cbmV4cG9ydCBjb25zdCB2YWxpZGF0ZUNyaXRlcmlhID0gKHsgaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3IH0pID0+IHtcbiAgbGV0IGludmFsaWQgPSBmYWxzZSwgcmVhc29ucyA9IFtdOyBcblxuICBpZih0eXBlb2YgaW5WaWV3VGhyZXNob2xkICE9PSAnbnVtYmVyJyB8fCBpblZpZXdUaHJlc2hvbGQgPiAxKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCdpblZpZXdUaHJlc2hvbGQgbXVzdCBiZSBhIG51bWJlciBlcXVhbCB0byBvciBsZXNzIHRoYW4gMScpO1xuICB9XG5cbiAgaWYodHlwZW9mIHRpbWVJblZpZXcgIT09ICdudW1iZXInIHx8IHRpbWVJblZpZXcgPCAwKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCd0aW1lSW5WaWV3IG11c3QgYmUgYSBudW1iZXIgZ3JlYXRlciB0byBvciBlcXVhbCAwJyk7XG4gIH1cblxuICByZXR1cm4geyBpbnZhbGlkLCByZWFzb25zOiByZWFzb25zLmpvaW4oJyB8ICcpIH07XG59O1xuXG5leHBvcnQgY29uc3QgdmFsaWRhdGVTdHJhdGVneSA9ICh7IGF1dG9zdGFydCwgdGVjaG5pcXVlcywgY3JpdGVyaWEgfSkgPT4ge1xuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107XG5cbiAgaWYodHlwZW9mIGF1dG9zdGFydCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCdhdXRvc3RhcnQgbXVzdCBiZSBib29sZWFuJyk7XG4gIH1cblxuICBpZighQXJyYXkuaXNBcnJheSh0ZWNobmlxdWVzKSB8fCB0ZWNobmlxdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCgndGVjaG5pcXVlcyBtdXN0IGJlIGFuIGFycmF5IGNvbnRhaW5pbmcgYXRsZWFzdCBvbiBtZWFzdXJlbWVudCB0ZWNobmlxdWVzJyk7XG4gIH1cblxuICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZUNyaXRlcmlhKGNyaXRlcmlhKTtcblxuICBpZih2YWxpZGF0ZWQuaW52YWxpZCkge1xuICAgIGludmFsaWQgPSB0cnVlO1xuICAgIHJlYXNvbnMucHVzaCh2YWxpZGF0ZWQucmVhc29ucyk7XG4gIH1cblxuICByZXR1cm4geyBpbnZhbGlkLCByZWFzb25zOiByZWFzb25zLmpvaW4oJyB8ICcpIH07XG59OyIsImV4cG9ydCBjb25zdCBTVEFSVCA9ICdzdGFydCc7XG5leHBvcnQgY29uc3QgU1RPUCA9ICdzdG9wJztcbmV4cG9ydCBjb25zdCBDSEFOR0UgPSAnY2hhbmdlJztcbmV4cG9ydCBjb25zdCBDT01QTEVURSA9ICdjb21wbGV0ZSc7XG5leHBvcnQgY29uc3QgVU5NRUFTVVJFQUJMRSA9ICd1bm1lYXN1cmVhYmxlJztcbmV4cG9ydCBjb25zdCBJTlZJRVcgPSAnaW52aWV3JztcbmV4cG9ydCBjb25zdCBPVVRWSUVXID0gJ291dHZpZXcnOyAiLCJpbXBvcnQgSW5WaWV3VGltZXIgZnJvbSAnLi4vVGltaW5nL0luVmlld1RpbWVyJztcbmltcG9ydCB7IGRlZmF1bHRTdHJhdGVneSB9IGZyb20gJy4vU3RyYXRlZ2llcy8nO1xuaW1wb3J0IHsgdmFsaWRUZWNobmlxdWUsIHZhbGlkYXRlU3RyYXRlZ3kgfSBmcm9tICcuLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vRXZlbnRzJztcblxuLy8gUmVzcG9uc2libGUgZm9yIGNvbGxlY3RpbmcgbWVhc3VyZW1lbnQgc3RyYXRlZ3ksXG4vLyB3YXRjaGluZyBmb3IgbWVhc3VyZW1lbnQgY2hhbmdlcyxcbi8vIHRyYWNraW5nIGhvdyBsb25nIGFuIGVsZW1lbnQgaXMgdmlld2FibGUgZm9yLFxuLy8gYW5kIG5vdGlmeWluZyBsaXN0ZW5lcnMgb2YgY2hhbmdlc1xuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWVhc3VyZW1lbnRFeGVjdXRvciB7XG4gIGNvbnN0cnVjdG9yKGVsZW1lbnQsIHN0cmF0ZWd5ID0ge30pIHtcbiAgICB0aGlzLl9saXN0ZW5lcnMgPSB7IHN0YXJ0OiBbXSwgc3RvcDogW10sIGNoYW5nZTogW10sIGNvbXBsZXRlOiBbXSwgdW5tZWFzdXJlYWJsZTogW10gfTtcbiAgICB0aGlzLl9lbGVtZW50ID0gZWxlbWVudDtcbiAgICB0aGlzLl9zdHJhdGVneSA9IE9iamVjdC5hc3NpZ24oe30sIGRlZmF1bHRTdHJhdGVneSwgc3RyYXRlZ3kpO1xuICAgIHRoaXMuX2NyaXRlcmlhTWV0ID0gZmFsc2U7XG5cbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVN0cmF0ZWd5KHRoaXMuX3N0cmF0ZWd5KTtcblxuICAgIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcbiAgICB9XG5cbiAgICB0aGlzLl90ZWNobmlxdWUgPSB0aGlzLl9zZWxlY3RUZWNobmlxdWUodGhpcy5fc3RyYXRlZ3kudGVjaG5pcXVlcyk7XG4gICAgXG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XG4gICAgICB0aGlzLl9hZGRTdWJzY3JpcHRpb25zKHRoaXMuX3RlY2huaXF1ZSk7XG4gICAgfSAgIFxuXG4gICAgaWYodGhpcy51bm1lYXN1cmVhYmxlKSB7XG4gICAgICAvLyBmaXJlIHVubWVhc3VyZWFibGUgYWZ0ZXIgY3VycmVudCBKUyBsb29wIGNvbXBsZXRlcyBcbiAgICAgIC8vIHNvIG9wcG9ydHVuaXR5IGlzIGdpdmVuIGZvciBjb25zdW1lcnMgdG8gcHJvdmlkZSB1bm1lYXN1cmVhYmxlIGNhbGxiYWNrXG4gICAgICBzZXRUaW1lb3V0KCAoKSA9PiB0aGlzLl9wdWJsaXNoKEV2ZW50cy5VTk1FQVNVUkVBQkxFLCBFbnZpcm9ubWVudC5nZXREZXRhaWxzKHRoaXMuX2VsZW1lbnQpKSwgMCk7XG4gICAgfVxuICAgIGVsc2UgaWYodGhpcy5fc3RyYXRlZ3kuYXV0b3N0YXJ0KSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWUuc3RhcnQoKTtcbiAgICB9XG4gIH1cblxuICBzdGFydCgpIHtcbiAgICB0aGlzLl90ZWNobmlxdWUuc3RhcnQoKTtcbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgaWYodGhpcy5fdGVjaG5pcXVlKSB7XG4gICAgICB0aGlzLl90ZWNobmlxdWUuZGlzcG9zZSgpO1xuICAgIH1cbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICB0aGlzLnRpbWVyLmRpc3Bvc2UoKTtcbiAgICB9XG5cbiAgfVxuXG4gIC8vIEV4cG9zZSBjYWxsYmFjayBpbnRlcmZhY2VzIHRvIEFQSSBjb25zdW1lclxuICBvblZpZXdhYmxlU3RhcnQoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5TVEFSVCk7XG4gIH1cblxuICBvblZpZXdhYmxlU3RvcChjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlNUT1ApO1xuICB9XG5cbiAgb25WaWV3YWJsZUNoYW5nZShjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLkNIQU5HRSk7XG4gIH1cblxuICBvblZpZXdhYmxlQ29tcGxldGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DT01QTEVURSk7XG4gIH1cblxuICBvblVubWVhc3VyZWFibGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5VTk1FQVNVUkVBQkxFKTtcbiAgfVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAhdGhpcy5fdGVjaG5pcXVlIHx8IHRoaXMuX3RlY2huaXF1ZS51bm1lYXN1cmVhYmxlO1xuICB9XG5cbiAgLy8gc2VsZWN0IGZpcnN0IHRlY2huaXF1ZSB0aGF0IGlzIG5vdCB1bm1lYXN1cmVhYmxlXG4gIF9zZWxlY3RUZWNobmlxdWUodGVjaG5pcXVlcykge1xuICAgIHJldHVybiB0ZWNobmlxdWVzXG4gICAgICAgICAgICAuZmlsdGVyKHZhbGlkVGVjaG5pcXVlKVxuICAgICAgICAgICAgLm1hcCh0aGlzLl9pbnN0YW50aWF0ZVRlY2huaXF1ZS5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLmZpbmQodGVjaG5pcXVlID0+ICF0ZWNobmlxdWUudW5tZWFzdXJlYWJsZSk7XG4gIH1cblxuICBfaW5zdGFudGlhdGVUZWNobmlxdWUodGVjaG5pcXVlKSB7XG4gICAgcmV0dXJuIG5ldyB0ZWNobmlxdWUoZWxlbWVudCwgdGhpcy5fc3RyYXRlZ3kuY3JpdGVyaWEpO1xuICB9XG5cbiAgX2FkZFN1YnNjcmlwdGlvbnModGVjaG5pcXVlKSB7XG4gICAgaWYodGVjaG5pcXVlKSB7XG4gICAgICB0ZWNobmlxdWUub25JblZpZXcodGhpcy5fdGVjaG5pcXVlQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLklOVklFVywgdGVjaG5pcXVlKSk7XG4gICAgICB0ZWNobmlxdWUub25DaGFuZ2VWaWV3KHRoaXMuX3RlY2huaXF1ZUNoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5DSEFOR0UsIHRlY2huaXF1ZSkpO1xuICAgICAgdGVjaG5pcXVlLm9uT3V0Vmlldyh0aGlzLl90ZWNobmlxdWVDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuT1VUVklFVywgdGVjaG5pcXVlKSk7XG4gICAgfVxuICB9XG5cbiAgX3RlY2huaXF1ZUNoYW5nZShjaGFuZ2UsIHRlY2huaXF1ZSkge1xuICAgIGxldCBldmVudE5hbWU7XG4gICAgY29uc3QgZGV0YWlscyA9IHRoaXMuX2FwcGVuZEVudmlyb25tZW50KHRlY2huaXF1ZSk7XG5cbiAgICBzd2l0Y2goY2hhbmdlKSB7XG4gICAgICBjYXNlIEV2ZW50cy5JTlZJRVc6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCl7XG4gICAgICAgICAgdGhpcy50aW1lciA9IG5ldyBJblZpZXdUaW1lcih0aGlzLl9zdHJhdGVneS5jcml0ZXJpYS50aW1lSW5WaWV3KTtcbiAgICAgICAgICB0aGlzLnRpbWVyLmVsYXBzZWQodGhpcy5fdGltZXJFbGFwc2VkLmJpbmQodGhpcywgdGVjaG5pcXVlKSk7XG4gICAgICAgICAgdGhpcy50aW1lci5zdGFydCgpO1xuICAgICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVEFSVDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLkNIQU5HRTpcbiAgICAgICAgZXZlbnROYW1lID0gY2hhbmdlO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuQ09NUExFVEU6XG4gICAgICAgIGlmKCF0aGlzLl9jcml0ZXJpYU1ldCkge1xuICAgICAgICAgIHRoaXMuX2NyaXRlcmlhTWV0ID0gdHJ1ZTtcbiAgICAgICAgICBldmVudE5hbWUgPSBjaGFuZ2U7XG4gICAgICAgIH1cbiAgICAgICAgXG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIEV2ZW50cy5PVVRWSUVXOlxuICAgICAgICBpZighdGhpcy5fY3JpdGVyaWFNZXQpIHtcbiAgICAgICAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICAgICAgICB0aGlzLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnRpbWVyO1xuICAgICAgICAgIH1cbiAgICAgICAgICBldmVudE5hbWUgPSBFdmVudHMuU1RPUDtcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYoZXZlbnROYW1lKSB7XG4gICAgICB0aGlzLl9wdWJsaXNoKGV2ZW50TmFtZSwgZGV0YWlscyk7XG4gICAgfVxuICB9XG5cbiAgX3B1Ymxpc2goZXZlbnQsIHZhbHVlKSB7XG4gICAgaWYoQXJyYXkuaXNBcnJheSh0aGlzLl9saXN0ZW5lcnNbZXZlbnRdKSkge1xuICAgICAgdGhpcy5fbGlzdGVuZXJzW2V2ZW50XS5mb3JFYWNoKCBsID0+IGwodmFsdWUpICk7XG4gICAgfVxuICB9XG5cbiAgX3RpbWVyRWxhcHNlZCh0ZWNobmlxdWUpIHtcbiAgICB0aGlzLl90ZWNobmlxdWVDaGFuZ2UoRXZlbnRzLkNPTVBMRVRFLCB0ZWNobmlxdWUpO1xuICB9XG5cbiAgX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHRoaXMuX2xpc3RlbmVyc1tldmVudF0gJiYgdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ0NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBfYXBwZW5kRW52aXJvbm1lbnQodGVjaG5pcXVlKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oXG4gICAgICB7fSwgXG4gICAgICB7IFxuICAgICAgICBwZXJjZW50Vmlld2FibGU6IHRlY2huaXF1ZS5wZXJjZW50Vmlld2FibGUsIFxuICAgICAgICB0ZWNobmlxdWU6IHRlY2huaXF1ZS50ZWNobmlxdWVOYW1lLCBcbiAgICAgICAgdmlld2FibGU6IHRlY2huaXF1ZS52aWV3YWJsZSBcbiAgICAgIH0sIFxuICAgICAgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzLl9lbGVtZW50KSBcbiAgICApO1xuICB9XG59IiwiZXhwb3J0IGRlZmF1bHQgY2xhc3MgQmFzZVRlY2huaXF1ZSB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMubGlzdGVuZXJzID0ge1xuICAgICAgaW5WaWV3OltdLFxuICAgICAgb3V0VmlldzpbXSxcbiAgICAgIGNoYW5nZVZpZXc6W11cbiAgICB9O1xuXG4gICAgdGhpcy5wZXJjZW50Vmlld2FibGUgPSAwLjA7XG4gIH1cblxuICAvLyBlbGVtZW50IGlzIGluIHZpZXcgYWNjb3JkaW5nIHRvIHN0cmF0ZWd5IGRlZmluZWQgYnkgY29uY3JldGUgbWVhc3VyZW1lbnQgY2xhc3NcbiAgb25JblZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnaW5WaWV3Jyk7XG4gIH1cblxuICBvbkNoYW5nZVZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnY2hhbmdlVmlldycpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBubyBsb25nZXIgaW4gdmlld1xuICBvbk91dFZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnb3V0VmlldycpO1xuICB9XG5cbiAgYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nICYmIHRoaXMubGlzdGVuZXJzW2V2ZW50XSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ2NhbGxiYWNrIG11c3QgYmUgZnVuY3Rpb24nO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZGlzcG9zZSgpIHt9XG5cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGdldCB0ZWNobmlxdWVOYW1lKCkge1xuICAgIHJldHVybiAnQmFzZVRlY2huaXF1ZSc7XG4gIH1cbn0iLCJleHBvcnQgZGVmYXVsdCBjbGFzcyBCYXNlVGVjaG5pcXVlIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5saXN0ZW5lcnMgPSB7XG4gICAgICBpblZpZXc6W10sXG4gICAgICBvdXRWaWV3OltdLFxuICAgICAgY2hhbmdlVmlldzpbXVxuICAgIH07XG5cbiAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IDAuMDtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgaXMgaW4gdmlldyBhY2NvcmRpbmcgdG8gc3RyYXRlZ3kgZGVmaW5lZCBieSBjb25jcmV0ZSBtZWFzdXJlbWVudCBjbGFzc1xuICBvbkluVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdpblZpZXcnKTtcbiAgfVxuXG4gIG9uQ2hhbmdlVmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdjaGFuZ2VWaWV3Jyk7XG4gIH1cblxuICAvLyBlbGVtZW50IG5vIGxvbmdlciBpbiB2aWV3XG4gIG9uT3V0VmlldyhjYikge1xuICAgIHJldHVybiB0aGlzLmFkZENhbGxiYWNrKGNiLCdvdXRWaWV3Jyk7XG4gIH1cblxuICBhZGRDYWxsYmFjayhjYWxsYmFjaywgZXZlbnQpIHtcbiAgICBpZih0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicgJiYgdGhpcy5saXN0ZW5lcnNbZXZlbnRdKSB7XG4gICAgICB0aGlzLmxpc3RlbmVyc1tldmVudF0ucHVzaChjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aHJvdyAnY2FsbGJhY2sgbXVzdCBiZSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBkaXNwb3NlKCkge31cblxuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBnZXQgdmlld2FibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZ2V0IHRlY2huaXF1ZU5hbWUoKSB7XG4gICAgcmV0dXJuICdCYXNlVGVjaG5pcXVlJztcbiAgfVxufSIsImltcG9ydCBCYXNldGVjaG5pcXVlIGZyb20gJy4vQmFzZXRlY2huaXF1ZSc7XG5pbXBvcnQgeyB2YWxpZEVsZW1lbnQgfSBmcm9tICcuLi8uLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlciBleHRlbmRzIEJhc2V0ZWNobmlxdWUge1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBjcml0ZXJpYSkge1xuICAgIHN1cGVyKGVsZW1lbnQsIGNyaXRlcmlhKTtcbiAgICBpZihjcml0ZXJpYSAhPT0gdW5kZWZpbmVkICYmIGVsZW1lbnQpIHtcbiAgICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgICB0aGlzLmNyaXRlcmlhID0gY3JpdGVyaWE7XG4gICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xuICAgICAgdGhpcy5zdGFydGVkID0gZmFsc2U7XG4gICAgICB0aGlzLm5vdGlmaWNhdGlvbkxldmVscyA9IFswLDAuMSwwLjIsMC4zLDAuNCwwLjUsMC42LDAuNywwLjgsMC45LDFdO1xuICAgICAgaWYodGhpcy5ub3RpZmljYXRpb25MZXZlbHMuaW5kZXhPZih0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkgPT09IC0xKSB7XG4gICAgICAgIHRoaXMubm90aWZpY2F0aW9uTGV2ZWxzLnB1c2godGhpcy5jcml0ZXJpYS5pblZpZXdUaHJlc2hvbGQpO1xuICAgICAgfVxuICAgIH1cbiAgICBlbHNlIGlmKCFlbGVtZW50KSB7XG4gICAgICB0aHJvdyAnZWxlbWVudCBub3QgcHJvdmlkZWQnO1xuICAgIH0gXG4gICAgZWxzZSBpZighY3JpdGVyaWEpIHtcbiAgICAgIHRocm93ICdjcml0ZXJpYSBub3QgcHJvdmlkZWQnO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgd2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyKHRoaXMudmlld2FibGVDaGFuZ2UuYmluZCh0aGlzKSx7IHRocmVzaG9sZDogdGhpcy5ub3RpZmljYXRpb25MZXZlbHMgfSk7XG4gICAgdGhpcy5vYnNlcnZlci5vYnNlcnZlKHRoaXMuZWxlbWVudCk7XG4gIH1cblxuICBkaXNwb3NlKCkge1xuICAgIGlmKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMub2JzZXJ2ZXIudW5vYnNlcnZlKGVsZW1lbnQpO1xuICAgICAgdGhpcy5vYnNlcnZlci5kaXNjb25uZWN0KGVsZW1lbnQpO1xuICAgIH1cbiAgfVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAoIXdpbmRvdy5JbnRlcnNlY3Rpb25PYnNlcnZlciB8fCB0aGlzLnVzZXNQb2x5ZmlsbCApIHx8ICF2YWxpZEVsZW1lbnQodGhpcy5lbGVtZW50KTtcbiAgfVxuXG4gIGdldCB2aWV3YWJsZSgpIHtcbiAgICByZXR1cm4gdGhpcy5pblZpZXc7XG4gIH1cblxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyJztcbiAgfVxuXG4gIC8vIGluZmVyIHBvbHlmaWxsIHVzYWdlIGJ5IGNoZWNraW5nIGlmIEludGVyc2VjdGlvbk9ic2VydmVyIEFQSSBoYXMgVEhST1RUTEVfVElNRU9VVCBtZW1tYmVyXG4gIGdldCB1c2VzUG9seWZpbGwoKSB7XG4gICAgcmV0dXJuIHR5cGVvZiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlRIUk9UVExFX1RJTUVPVVQgPT09ICdudW1iZXInO1xuICB9XG5cbiAgdmlld2FibGVDaGFuZ2UoZW50cmllcykge1xuICAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW87XG4gICAgICBcbiAgICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPCB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCAmJiB0aGlzLnN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5pblZpZXcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMub3V0Vmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuICAgICAgaWYoZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyA+PSB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnN0YXJ0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLmluVmlldyA9IHRydWU7XG4gICAgICAgIHRoaXMubGlzdGVuZXJzLmluVmlldy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxpc3RlbmVycy5jaGFuZ2VWaWV3LmZvckVhY2goIGwgPT4gbCgpICk7XG4gICAgfVxuICB9XG5cbn0iLCJpbXBvcnQgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5pbXBvcnQgUG9seWZpbGwgZnJvbSAnaW50ZXJzZWN0aW9uLW9ic2VydmVyJztcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4uLy4uL0Vudmlyb25tZW50L0Vudmlyb25tZW50JztcblxuLy8gV2Ugb25seSBuZWVkIHRvIG92ZXJyaWRlIGEgZmV3IGFzcGVjdHMgb2YgdGhlIG5hdGl2ZSBpbXBsZW1lbnRhdGlvbidzIG1lYXN1cmVyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIGV4dGVuZHMgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIge1xuICBnZXQgdW5tZWFzdXJlYWJsZSgpIHtcbiAgICByZXR1cm4gRW52aXJvbm1lbnQuaUZyYW1lQ29udGV4dCgpID09PSBFbnZpcm9ubWVudC5pRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLkNST1NTX0RPTUFJTl9JRlJBTUU7XG4gIH1cblxuICBnZXQgdGVjaG5pcXVlTmFtZSgpIHtcbiAgICByZXR1cm4gJ0ludGVyc2VjdGlvbk9ic2VydmVyUG9seUZpbGwnO1xuICB9XG59IiwiZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB9IGZyb20gJy4vSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBJbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsJztcbmV4cG9ydCB7IGRlZmF1bHQgYXMgQmFzZVRlY2huaXF1ZSB9IGZyb20gJy4vQmFzZVRlY2huaXF1ZSc7IiwiaW1wb3J0ICogYXMgVmFsaWRhdG9ycyBmcm9tICcuLi8uLi9IZWxwZXJzL1ZhbGlkYXRvcnMnO1xuaW1wb3J0ICogYXMgTWVhc3VyZW1lbnRUZWNobmlxdWVzIGZyb20gJy4uL01lYXN1cmVtZW50VGVjaG5pcXVlcy8nO1xuaW1wb3J0ICogYXMgVmlld2FiaWxpdHlDcml0ZXJpYSBmcm9tICcuLi8uLi9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEnO1xuXG5leHBvcnQgY29uc3QgZGVmYXVsdFN0cmF0ZWd5ID0ge1xuICBhdXRvc3RhcnQ6IHRydWUsXG4gIHRlY2huaXF1ZXM6IFtNZWFzdXJlbWVudFRlY2huaXF1ZXMuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIsIE1lYXN1cmVtZW50VGVjaG5pcXVlcy5JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsXSxcbiAgY3JpdGVyaWE6IFZpZXdhYmlsaXR5Q3JpdGVyaWEuTVJDX1ZJREVPXG59O1xuXG5leHBvcnQgY29uc3QgU3RyYXRlZ3lGYWN0b3J5ID0gKGF1dG9zdGFydCA9IGRlZmF1bHRTdHJhdGVneS5hdXRvc3RhcnQsIHRlY2huaXF1ZXMgPSBkZWZhdWx0U3RyYXRlZ3kudGVjaG5pcXVlcywgY3JpdGVyaWEgPSBkZWZhdWx0U3RyYXRlZ3kuY3JpdGVyaWEpID0+IHtcbiAgY29uc3Qgc3RyYXRlZ3kgPSB7IGF1dG9zdGFydCwgdGVjaG5pcXVlcywgY3JpdGVyaWEgfSxcbiAgICAgICAgdmFsaWRhdGVkID0gVmFsaWRhdG9ycy52YWxpZGF0ZVN0cmF0ZWd5KHN0cmF0ZWd5KTsgIFxuXG4gIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgdGhyb3cgdmFsaWRhdGVkLnJlYXNvbnM7XG4gIH1cblxuICByZXR1cm4gc3RyYXRlZ3k7XG59OyIsImltcG9ydCAqIGFzIEV2ZW50cyBmcm9tICcuL01lYXN1cmVtZW50L0V2ZW50cyc7XG5pbXBvcnQgSW5WaWV3VGltZXIgZnJvbSAnLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0ICogYXMgU3RyYXRlZ2llcyBmcm9tICcuL01lYXN1cmVtZW50L1N0cmF0ZWdpZXMvJztcbmltcG9ydCAqIGFzIEVudmlyb25tZW50IGZyb20gJy4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuaW1wb3J0IE1lYXN1cmVtZW50RXhlY3V0b3IgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudEV4ZWN1dG9yJztcbmltcG9ydCAqIGFzIFZpZXdhYmlsaXR5Q3JpdGVyaWEgZnJvbSAnLi9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEnO1xuaW1wb3J0ICogYXMgTWVhc3VyZW1lbnRUZWNobmlxdWVzIGZyb20gJy4vTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUZWNobmlxdWVzLyc7XG5cbi8vIE1haW4gZW50cnkgcG9pbnRcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE9wZW5WViB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuZXhlY3V0b3JzID0gW107XG4gIH1cblxuICBtZWFzdXJlRWxlbWVudChlbGVtZW50LCBzdHJhdGVneSkge1xuICAgIGNvbnN0IGV4ZWN1dG9yID0gbmV3IE1lYXN1cmVtZW50RXhlY3V0b3IoZWxlbWVudCwgc3RyYXRlZ3kpO1xuICAgIHRoaXMuZXhlY3V0b3JzLnB1c2goZXhlY3V0b3IpO1xuICAgIHJldHVybiBleGVjdXRvcjtcbiAgfSBcbn1cblxuLy8gRXhwb3NlIHN1cHBvcnQgY2xhc3NlcyAvIGNvbnN0YW50c1xuT3BlblZWLlZpZXdhYmlsaXR5Q3JpdGVyaWEgPSBWaWV3YWJpbGl0eUNyaXRlcmlhO1xuT3BlblZWLk1lYXN1cmVtZW50RXhlY3V0b3IgPSBNZWFzdXJlbWVudEV4ZWN1dG9yO1xuT3BlblZWLk1lYXN1cmVtZW50VGVjaG5pcXVlcyA9IE1lYXN1cmVtZW50VGVjaG5pcXVlcztcbk9wZW5WVi5JblZpZXdUaW1lciA9IEluVmlld1RpbWVyO1xuT3BlblZWLlN0cmF0ZWdpZXMgPSBTdHJhdGVnaWVzO1xuT3BlblZWLkV2ZW50cyA9IEV2ZW50czsiLCJleHBvcnQgY29uc3QgTVJDX1ZJREVPID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMjAwMFxufTtcblxuZXhwb3J0IGNvbnN0IE1SQ19ESVNQTEFZID0ge1xuICBpblZpZXdUaHJlc2hvbGQ6IDAuNSxcbiAgdGltZUluVmlldzogMTAwMFxufTtcblxuZXhwb3J0IGNvbnN0IGN1c3RvbUNyaXRlcmlhID0gKGluVmlld1RocmVzaG9sZCwgdGltZUluVmlldykgPT4gKHsgaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3IH0pOyIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEluVmlld1RpbWVyIHtcbiAgY29uc3RydWN0b3IoZHVyYXRpb24pIHtcbiAgICB0aGlzLmR1cmF0aW9uID0gZHVyYXRpb247ICAgICAgXG4gICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IGZhbHNlO1xuICB9XG5cbiAgdGltZXJDb21wbGV0ZSgpIHtcbiAgICB0aGlzLmNvbXBsZXRlZCA9IHRydWU7XG4gICAgdGhpcy5saXN0ZW5lcnMuZm9yRWFjaCggbCA9PiBsKCkgKTtcbiAgfVxuXG4gIGVsYXBzZWQoY2IpIHtcbiAgICBpZih0eXBlb2YgY2IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnB1c2goY2IpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgICB0aGlzLnRpbWVyID0gc2V0VGltZW91dCh0aGlzLnRpbWVyQ29tcGxldGUuYmluZCh0aGlzKSwgdGhpcy5kdXJhdGlvbik7XG4gIH1cblxuICBzdG9wKCkge1xuICAgIHRoaXMuZW5kVGltZXIoKTtcbiAgfVxuXG4gIHBhdXNlKCkge1xuICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcbiAgfVxuXG4gIHJlc3VtZSgpIHtcbiAgICB0aGlzLnRpbWVyID0gc2V0VGltZW91dCh0aGlzLnRpbWVyQ29tcGxldGUuYmluZCh0aGlzKSwgdGhpcy5kdXJhdGlvbik7XG4gIH1cblxuICBlbmRUaW1lcigpIHtcbiAgICBpZih0aGlzLnRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lcik7XG4gICAgICB0aGlzLmxpc3RlbmVycy5sZW5ndGggPSAwO1xuICAgIH1cbiAgfVxuXG4gIGRpc3Bvc2UoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbn0iXX0=
