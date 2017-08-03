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
var getDetails = exports.getDetails = function getDetails(_ref) {
  var element = _ref.element;

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
exports.validateStrategy = exports.validateCriteria = exports.validTactic = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _BaseTactic = require('../Measurement/MeasurementTactics/BaseTactic');

var _BaseTactic2 = _interopRequireDefault(_BaseTactic);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ensure tactic atleast has the same properties and methods of AbstractTimer
var validTactic = exports.validTactic = function validTactic(tactic) {
  var valid = typeof tactic === 'function' && Object.getOwnPropertyNames(_BaseTactic2.default).reduce(function (prop, valid) {
    return valid && _typeof(tactic[prop]) === _typeof(_BaseTactic2.default[prop]);
  }, true);

  return valid;
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
      tactics = _ref2.tactics,
      criteria = _ref2.criteria;

  var invalid = false,
      reasons = [];

  if (typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if (!Array.isArray(tactics) || tactics.length === 0) {
    invalid = true;
    reasons.push('tactics must be an array containing atleast on measurement tactics');
  }

  var validated = validateCriteria(criteria);

  if (validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid: invalid, reasons: reasons.join(' | ') };
};

},{"../Measurement/MeasurementTactics/BaseTactic":6}],4:[function(require,module,exports){
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

    this.timers = {};
    this._listeners = { start: [], stop: [], change: [], complete: [], unmeasureable: [] };
    this.element = element;
    this.strategy = _extends({}, _Strategies.defaultStrategy, strategy);

    var validated = (0, _Validators.validateStrategy)(this.strategy);

    if (validated.invalid) {
      throw validated.reasons;
    }

    this.tactic = this._selectTactic(this.strategy.tactics);

    if (this.tactic) {
      this._addSubscriptions(this.tactic);
    }

    if (this.unmeasureable) {
      // fire unmeasureable after current JS loop completes 
      // so opportunity is given for consumers to provide unmeasureable callback
      setTimeout(function () {
        return _this._publish(Events.UNMEASUREABLE, Environment.getDetails(_this));
      }, 0);
    } else if (this.strategy.autostart) {
      this.tactic.start();
    }
  }

  _createClass(MeasurementExecutor, [{
    key: 'start',
    value: function start() {
      this.tactic.start();
    }
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
    key: '_selectTactic',


    // select first tactic that is not unmeasureable
    value: function _selectTactic(tactics) {
      return tactics.filter(_Validators.validTactic).map(this._instantiateTactic.bind(this)).find(function (tactic) {
        return !tactic.unmeasureable;
      });
    }
  }, {
    key: '_instantiateTactic',
    value: function _instantiateTactic(tactic) {
      return new tactic(element, this.strategy.criteria);
    }
  }, {
    key: '_addSubscriptions',
    value: function _addSubscriptions(tactic) {
      if (tactic) {
        tactic.onInView(this._tacticChange.bind(this, Events.INVIEW, tactic));
        tactic.onChangeView(this._tacticChange.bind(this, Events.CHANGE, tactic));
        tactic.onOutView(this._tacticChange.bind(this, Events.OUTVIEW, tactic));
      }
    }
  }, {
    key: '_tacticChange',
    value: function _tacticChange(change, tactic) {
      var eventName = void 0;
      var details = this._appendEnvironment(tactic);

      switch (change) {
        case Events.INVIEW:
          this.timer = new _InViewTimer2.default(this.strategy.criteria.timeInView);
          this.timer.elapsed(this._timerElapsed.bind(this, tactic));
          this.timer.start();
          eventName = Events.START;
          break;

        case Events.CHANGE:
          eventName = change;
          break;

        case Events.COMPLETE:
          eventName = change;
          break;

        case Events.OUTVIEW:
          if (this.timer) {
            this.timer.stop();
            delete this.timer;
          }
          eventName = Events.STOP;
          break;
      }

      this._publish(eventName, details);
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
    value: function _timerElapsed(tactic) {
      this._tacticChange(Events.COMPLETE, tactic);
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
    value: function _appendEnvironment(tactic) {
      return _extends({}, { percentViewable: tactic.percentViewable, tactic: tactic.tacticName }, Environment.getDetails(this));
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return !this.tactic || this.tactic.unmeasureable;
    }
  }]);

  return MeasurementExecutor;
}();

exports.default = MeasurementExecutor;
module.exports = exports['default'];

},{"../Environment/Environment":2,"../Helpers/Validators":3,"../Timing/InViewTimer":13,"./Events":4,"./Strategies/":10}],6:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BaseTactic = function () {
  function BaseTactic() {
    _classCallCheck(this, BaseTactic);

    this.listeners = {
      inView: [],
      outView: []
    };

    this.percentViewable = 0.0;
  }

  // element is in view according to strategy defined by concrete measurement class


  _createClass(BaseTactic, [{
    key: 'onInView',
    value: function onInView(cb) {
      return this.addCallback(cb, 'inView');
    }
  }, {
    key: 'onChangeView',
    value: function onChangeView(cb) {
      return this.addCallback(cb, 'viewChange');
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
    key: 'unmeasureable',
    get: function get() {
      return false;
    }
  }, {
    key: 'viewable',
    get: function get() {
      return false;
    }
  }]);

  return BaseTactic;
}();

exports.default = BaseTactic;
module.exports = exports['default'];

},{}],7:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _BaseTactic2 = require('./BaseTactic');

var _BaseTactic3 = _interopRequireDefault(_BaseTactic2);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var IntersectionObserver = function (_BaseTactic) {
  _inherits(IntersectionObserver, _BaseTactic);

  function IntersectionObserver(element, criteria) {
    _classCallCheck(this, IntersectionObserver);

    var _this = _possibleConstructorReturn(this, (IntersectionObserver.__proto__ || Object.getPrototypeOf(IntersectionObserver)).call(this, element, criteria));

    if (criteria !== undefined && element) {
      _this.element = element;
      _this.criteria = criteria;
      _this.inView = false;
      _this.started = false;
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
      this.observer = new window.IntersectionObserver(this.viewableChange.bind(this), { threshold: this.criteria.inViewThreshold });
      this.observer.observe(this.element);
    }
  }, {
    key: 'viewableChange',
    value: function viewableChange(entries) {
      var _this2 = this;

      if (entries && entries.length && entries[0].intersectionRatio !== undefined) {
        this.percentViewable = entries[0].intersectionRatio;

        if (entries[0].intersectionRatio < this.criteria.inViewThreshold && this.started) {
          this.inView = false;
          this.listeners.outView.forEach(function (l) {
            return l(_this2.percentViewable);
          });
        }
        if (entries[0].intersectionRatio >= this.criteria.inViewThreshold) {
          this.started = true;
          this.inView = true;
          this.listeners.inView.forEach(function (l) {
            return l(_this2.percentViewable);
          });
        }
      }
    }
  }, {
    key: 'unmeasureable',
    get: function get() {
      return (!window.IntersectionObserver || typeof window.IntersectionObserver.prototype.THROTTLE_TIMEOUT === 'number') && this.element.toString().indexOf('Element') > -1; // ensure intersection observer is available and element is an actual element and not a proxy
    }
  }, {
    key: 'viewable',
    get: function get() {
      return this.inView;
    }
  }, {
    key: 'tacticName',
    get: function get() {
      return 'IntersectionObserver';
    }
  }]);

  return IntersectionObserver;
}(_BaseTactic3.default);

exports.default = IntersectionObserver;
module.exports = exports['default'];

},{"./BaseTactic":6}],8:[function(require,module,exports){
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
    key: 'tacticName',
    get: function get() {
      return 'IntersectionObserverPolyFill';
    }
  }]);

  return IntersectionObserverPolyfill;
}(_IntersectionObserver3.default);

exports.default = IntersectionObserverPolyfill;
module.exports = exports['default'];

},{"../../Environment/Environment":2,"./IntersectionObserver":7,"intersection-observer":1}],9:[function(require,module,exports){
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

var _BaseTactic = require('./BaseTactic');

Object.defineProperty(exports, 'BaseTactic', {
  enumerable: true,
  get: function get() {
    return _interopRequireDefault(_BaseTactic).default;
  }
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

},{"./BaseTactic":6,"./IntersectionObserver":7,"./IntersectionObserverPolyfill":8}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.StrategyFactory = exports.defaultStrategy = undefined;

var _Validators = require('../../Helpers/Validators');

var Validators = _interopRequireWildcard(_Validators);

var _MeasurementTactics = require('../MeasurementTactics/');

var MeasurementTactics = _interopRequireWildcard(_MeasurementTactics);

var _ViewabilityCriteria = require('../../Options/ViewabilityCriteria');

var ViewabilityCriteria = _interopRequireWildcard(_ViewabilityCriteria);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

var defaultStrategy = exports.defaultStrategy = {
  autostart: true,
  tactics: [MeasurementTactics.IntersectionObserver, MeasurementTactics.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};

var StrategyFactory = exports.StrategyFactory = function StrategyFactory() {
  var autostart = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : defaultStrategy.autostart;
  var tactics = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : defaultStrategy.tactics;
  var criteria = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : defaultStrategy.criteria;

  var strategy = { autostart: autostart, tactics: tactics, criteria: criteria },
      validated = Validators.validateStrategy(strategy);

  if (validated.invalid) {
    throw validated.reasons;
  }

  return strategy;
};

},{"../../Helpers/Validators":3,"../../Options/ViewabilityCriteria":12,"../MeasurementTactics/":9}],11:[function(require,module,exports){
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

var _MeasurementTactics = require('./Measurement/MeasurementTactics/');

var MeasurementTactics = _interopRequireWildcard(_MeasurementTactics);

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
OpenVV.MeasurementTactics = MeasurementTactics;
OpenVV.InViewTimer = _InViewTimer2.default;
OpenVV.Strategies = Strategies;
OpenVV.Events = Events;
module.exports = exports['default'];

},{"./Environment/Environment":2,"./Measurement/Events":4,"./Measurement/MeasurementExecutor":5,"./Measurement/MeasurementTactics/":9,"./Measurement/Strategies/":10,"./Options/ViewabilityCriteria":12,"./Timing/InViewTimer":13}],12:[function(require,module,exports){
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

},{}],13:[function(require,module,exports){
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
  }]);

  return InViewTimer;
}();

exports.default = InViewTimer;
module.exports = exports['default'];

},{}]},{},[11])(11)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvaW50ZXJzZWN0aW9uLW9ic2VydmVyL2ludGVyc2VjdGlvbi1vYnNlcnZlci5qcyIsInNyYy9FbnZpcm9ubWVudC9FbnZpcm9ubWVudC5qcyIsInNyYy9IZWxwZXJzL1ZhbGlkYXRvcnMuanMiLCJzcmMvTWVhc3VyZW1lbnQvRXZlbnRzLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3IuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUYWN0aWNzL0Jhc2VUYWN0aWMuanMiLCJzcmMvTWVhc3VyZW1lbnQvTWVhc3VyZW1lbnRUYWN0aWNzL0ludGVyc2VjdGlvbk9ic2VydmVyLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGFjdGljcy9JbnRlcnNlY3Rpb25PYnNlcnZlclBvbHlmaWxsLmpzIiwic3JjL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGFjdGljcy9pbmRleC5qcyIsInNyYy9NZWFzdXJlbWVudC9TdHJhdGVnaWVzL2luZGV4LmpzIiwic3JjL09wZW5WVi5qcyIsInNyYy9PcHRpb25zL1ZpZXdhYmlsaXR5Q3JpdGVyaWEuanMiLCJzcmMvVGltaW5nL0luVmlld1RpbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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O0FBQ0Q7Ozs0QkFFTyxFLEVBQUk7QUFDVixVQUFHLE9BQU8sRUFBUCxLQUFjLFVBQWpCLEVBQTZCO0FBQzNCLGFBQUssU0FBTCxDQUFlLElBQWYsQ0FBb0IsRUFBcEI7QUFDRDtBQUNGOzs7NEJBRU87QUFDTixXQUFLLFFBQUw7QUFDQSxXQUFLLEtBQUwsR0FBYSxXQUFXLEtBQUssYUFBTCxDQUFtQixJQUFuQixDQUF3QixJQUF4QixDQUFYLEVBQTBDLEtBQUssUUFBL0MsQ0FBYjtBQUNEOzs7MkJBRU07QUFDTCxXQUFLLFFBQUw7QUFDRDs7OzRCQUVPO0FBQ04sbUJBQWEsS0FBSyxLQUFsQjtBQUNEOzs7NkJBRVE7QUFDUCxXQUFLLEtBQUwsR0FBYSxXQUFXLEtBQUssYUFBTCxDQUFtQixJQUFuQixDQUF3QixJQUF4QixDQUFYLEVBQTBDLEtBQUssUUFBL0MsQ0FBYjtBQUNEOzs7K0JBRVU7QUFDVCxVQUFHLEtBQUssS0FBUixFQUFlO0FBQ2IscUJBQWEsS0FBSyxLQUFsQjtBQUNBLGFBQUssU0FBTCxDQUFlLE1BQWYsR0FBd0IsQ0FBeEI7QUFDRDtBQUNGOzs7Ozs7a0JBeENrQixXIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qKlxuICogQ29weXJpZ2h0IDIwMTYgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQXBhY2hlIExpY2Vuc2UsIFZlcnNpb24gMi4wICh0aGUgXCJMaWNlbnNlXCIpO1xuICogeW91IG1heSBub3QgdXNlIHRoaXMgZmlsZSBleGNlcHQgaW4gY29tcGxpYW5jZSB3aXRoIHRoZSBMaWNlbnNlLlxuICogWW91IG1heSBvYnRhaW4gYSBjb3B5IG9mIHRoZSBMaWNlbnNlIGF0XG4gKlxuICogICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKi9cblxuKGZ1bmN0aW9uKHdpbmRvdywgZG9jdW1lbnQpIHtcbid1c2Ugc3RyaWN0JztcblxuXG4vLyBFeGl0cyBlYXJseSBpZiBhbGwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgYW5kIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnlcbi8vIGZlYXR1cmVzIGFyZSBuYXRpdmVseSBzdXBwb3J0ZWQuXG5pZiAoJ0ludGVyc2VjdGlvbk9ic2VydmVyJyBpbiB3aW5kb3cgJiZcbiAgICAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeScgaW4gd2luZG93ICYmXG4gICAgJ2ludGVyc2VjdGlvblJhdGlvJyBpbiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeS5wcm90b3R5cGUpIHtcbiAgcmV0dXJuO1xufVxuXG5cbi8qKlxuICogQW4gSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkuIFRoaXMgcmVnaXN0cnkgZXhpc3RzIHRvIGhvbGQgYSBzdHJvbmdcbiAqIHJlZmVyZW5jZSB0byBJbnRlcnNlY3Rpb25PYnNlcnZlciBpbnN0YW5jZXMgY3VycmVudGx5IG9ic2VydmVyaW5nIGEgdGFyZ2V0XG4gKiBlbGVtZW50LiBXaXRob3V0IHRoaXMgcmVnaXN0cnksIGluc3RhbmNlcyB3aXRob3V0IGFub3RoZXIgcmVmZXJlbmNlIG1heSBiZVxuICogZ2FyYmFnZSBjb2xsZWN0ZWQuXG4gKi9cbnZhciByZWdpc3RyeSA9IFtdO1xuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyRW50cnkgY29uc3RydWN0b3IuXG4gKiBodHRwczovL3dpY2cuZ2l0aHViLmlvL0ludGVyc2VjdGlvbk9ic2VydmVyLyNpbnRlcnNlY3Rpb24tb2JzZXJ2ZXItZW50cnlcbiAqIEBwYXJhbSB7T2JqZWN0fSBlbnRyeSBBIGRpY3Rpb25hcnkgb2YgaW5zdGFuY2UgcHJvcGVydGllcy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5KGVudHJ5KSB7XG4gIHRoaXMudGltZSA9IGVudHJ5LnRpbWU7XG4gIHRoaXMudGFyZ2V0ID0gZW50cnkudGFyZ2V0O1xuICB0aGlzLnJvb3RCb3VuZHMgPSBlbnRyeS5yb290Qm91bmRzO1xuICB0aGlzLmJvdW5kaW5nQ2xpZW50UmVjdCA9IGVudHJ5LmJvdW5kaW5nQ2xpZW50UmVjdDtcbiAgdGhpcy5pbnRlcnNlY3Rpb25SZWN0ID0gZW50cnkuaW50ZXJzZWN0aW9uUmVjdCB8fCBnZXRFbXB0eVJlY3QoKTtcbiAgdGhpcy5pc0ludGVyc2VjdGluZyA9ICEhZW50cnkuaW50ZXJzZWN0aW9uUmVjdDtcblxuICAvLyBDYWxjdWxhdGVzIHRoZSBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIHZhciB0YXJnZXRSZWN0ID0gdGhpcy5ib3VuZGluZ0NsaWVudFJlY3Q7XG4gIHZhciB0YXJnZXRBcmVhID0gdGFyZ2V0UmVjdC53aWR0aCAqIHRhcmdldFJlY3QuaGVpZ2h0O1xuICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHRoaXMuaW50ZXJzZWN0aW9uUmVjdDtcbiAgdmFyIGludGVyc2VjdGlvbkFyZWEgPSBpbnRlcnNlY3Rpb25SZWN0LndpZHRoICogaW50ZXJzZWN0aW9uUmVjdC5oZWlnaHQ7XG5cbiAgLy8gU2V0cyBpbnRlcnNlY3Rpb24gcmF0aW8uXG4gIGlmICh0YXJnZXRBcmVhKSB7XG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IGludGVyc2VjdGlvbkFyZWEgLyB0YXJnZXRBcmVhO1xuICB9IGVsc2Uge1xuICAgIC8vIElmIGFyZWEgaXMgemVybyBhbmQgaXMgaW50ZXJzZWN0aW5nLCBzZXRzIHRvIDEsIG90aGVyd2lzZSB0byAwXG4gICAgdGhpcy5pbnRlcnNlY3Rpb25SYXRpbyA9IHRoaXMuaXNJbnRlcnNlY3RpbmcgPyAxIDogMDtcbiAgfVxufVxuXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIGNvbnN0cnVjdG9yLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jaW50ZXJzZWN0aW9uLW9ic2VydmVyLWludGVyZmFjZVxuICogQHBhcmFtIHtGdW5jdGlvbn0gY2FsbGJhY2sgVGhlIGZ1bmN0aW9uIHRvIGJlIGludm9rZWQgYWZ0ZXIgaW50ZXJzZWN0aW9uXG4gKiAgICAgY2hhbmdlcyBoYXZlIHF1ZXVlZC4gVGhlIGZ1bmN0aW9uIGlzIG5vdCBpbnZva2VkIGlmIHRoZSBxdWV1ZSBoYXNcbiAqICAgICBiZWVuIGVtcHRpZWQgYnkgY2FsbGluZyB0aGUgYHRha2VSZWNvcmRzYCBtZXRob2QuXG4gKiBAcGFyYW0ge09iamVjdD19IG9wdF9vcHRpb25zIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAqIEBjb25zdHJ1Y3RvclxuICovXG5mdW5jdGlvbiBJbnRlcnNlY3Rpb25PYnNlcnZlcihjYWxsYmFjaywgb3B0X29wdGlvbnMpIHtcblxuICB2YXIgb3B0aW9ucyA9IG9wdF9vcHRpb25zIHx8IHt9O1xuXG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cblxuICBpZiAob3B0aW9ucy5yb290ICYmIG9wdGlvbnMucm9vdC5ub2RlVHlwZSAhPSAxKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdyb290IG11c3QgYmUgYW4gRWxlbWVudCcpO1xuICB9XG5cbiAgLy8gQmluZHMgYW5kIHRocm90dGxlcyBgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zYC5cbiAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zID0gdGhyb3R0bGUoXG4gICAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMuYmluZCh0aGlzKSwgdGhpcy5USFJPVFRMRV9USU1FT1VUKTtcblxuICAvLyBQcml2YXRlIHByb3BlcnRpZXMuXG4gIHRoaXMuX2NhbGxiYWNrID0gY2FsbGJhY2s7XG4gIHRoaXMuX29ic2VydmF0aW9uVGFyZ2V0cyA9IFtdO1xuICB0aGlzLl9xdWV1ZWRFbnRyaWVzID0gW107XG4gIHRoaXMuX3Jvb3RNYXJnaW5WYWx1ZXMgPSB0aGlzLl9wYXJzZVJvb3RNYXJnaW4ob3B0aW9ucy5yb290TWFyZ2luKTtcblxuICAvLyBQdWJsaWMgcHJvcGVydGllcy5cbiAgdGhpcy50aHJlc2hvbGRzID0gdGhpcy5faW5pdFRocmVzaG9sZHMob3B0aW9ucy50aHJlc2hvbGQpO1xuICB0aGlzLnJvb3QgPSBvcHRpb25zLnJvb3QgfHwgbnVsbDtcbiAgdGhpcy5yb290TWFyZ2luID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgcmV0dXJuIG1hcmdpbi52YWx1ZSArIG1hcmdpbi51bml0O1xuICB9KS5qb2luKCcgJyk7XG59XG5cblxuLyoqXG4gKiBUaGUgbWluaW11bSBpbnRlcnZhbCB3aXRoaW4gd2hpY2ggdGhlIGRvY3VtZW50IHdpbGwgYmUgY2hlY2tlZCBmb3JcbiAqIGludGVyc2VjdGlvbiBjaGFuZ2VzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuVEhST1RUTEVfVElNRU9VVCA9IDEwMDtcblxuXG4vKipcbiAqIFRoZSBmcmVxdWVuY3kgaW4gd2hpY2ggdGhlIHBvbHlmaWxsIHBvbGxzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIHRoaXMgY2FuIGJlIHVwZGF0ZWQgb24gYSBwZXIgaW5zdGFuY2UgYmFzaXMgYW5kIG11c3QgYmUgc2V0IHByaW9yIHRvXG4gKiBjYWxsaW5nIGBvYnNlcnZlYCBvbiB0aGUgZmlyc3QgdGFyZ2V0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuUE9MTF9JTlRFUlZBTCA9IG51bGw7XG5cblxuLyoqXG4gKiBTdGFydHMgb2JzZXJ2aW5nIGEgdGFyZ2V0IGVsZW1lbnQgZm9yIGludGVyc2VjdGlvbiBjaGFuZ2VzIGJhc2VkIG9uXG4gKiB0aGUgdGhyZXNob2xkcyB2YWx1ZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLm9ic2VydmUgPSBmdW5jdGlvbih0YXJnZXQpIHtcbiAgLy8gSWYgdGhlIHRhcmdldCBpcyBhbHJlYWR5IGJlaW5nIG9ic2VydmVkLCBkbyBub3RoaW5nLlxuICBpZiAodGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnNvbWUoZnVuY3Rpb24oaXRlbSkge1xuICAgIHJldHVybiBpdGVtLmVsZW1lbnQgPT0gdGFyZ2V0O1xuICB9KSkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghKHRhcmdldCAmJiB0YXJnZXQubm9kZVR5cGUgPT0gMSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3RhcmdldCBtdXN0IGJlIGFuIEVsZW1lbnQnKTtcbiAgfVxuXG4gIHRoaXMuX3JlZ2lzdGVySW5zdGFuY2UoKTtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLnB1c2goe2VsZW1lbnQ6IHRhcmdldCwgZW50cnk6IG51bGx9KTtcbiAgdGhpcy5fbW9uaXRvckludGVyc2VjdGlvbnMoKTtcbn07XG5cblxuLyoqXG4gKiBTdG9wcyBvYnNlcnZpbmcgYSB0YXJnZXQgZWxlbWVudCBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMuXG4gKiBAcGFyYW0ge0VsZW1lbnR9IHRhcmdldCBUaGUgRE9NIGVsZW1lbnQgdG8gb2JzZXJ2ZS5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLnVub2JzZXJ2ZSA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0aGlzLl9vYnNlcnZhdGlvblRhcmdldHMgPVxuICAgICAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZpbHRlcihmdW5jdGlvbihpdGVtKSB7XG5cbiAgICByZXR1cm4gaXRlbS5lbGVtZW50ICE9IHRhcmdldDtcbiAgfSk7XG4gIGlmICghdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmxlbmd0aCkge1xuICAgIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgICB0aGlzLl91bnJlZ2lzdGVySW5zdGFuY2UoKTtcbiAgfVxufTtcblxuXG4vKipcbiAqIFN0b3BzIG9ic2VydmluZyBhbGwgdGFyZ2V0IGVsZW1lbnRzIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLmRpc2Nvbm5lY3QgPSBmdW5jdGlvbigpIHtcbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzID0gW107XG4gIHRoaXMuX3VubW9uaXRvckludGVyc2VjdGlvbnMoKTtcbiAgdGhpcy5fdW5yZWdpc3Rlckluc3RhbmNlKCk7XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyBhbnkgcXVldWUgZW50cmllcyB0aGF0IGhhdmUgbm90IHlldCBiZWVuIHJlcG9ydGVkIHRvIHRoZVxuICogY2FsbGJhY2sgYW5kIGNsZWFycyB0aGUgcXVldWUuIFRoaXMgY2FuIGJlIHVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCB0aGVcbiAqIGNhbGxiYWNrIHRvIG9idGFpbiB0aGUgYWJzb2x1dGUgbW9zdCB1cC10by1kYXRlIGludGVyc2VjdGlvbiBpbmZvcm1hdGlvbi5cbiAqIEByZXR1cm4ge0FycmF5fSBUaGUgY3VycmVudGx5IHF1ZXVlZCBlbnRyaWVzLlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUudGFrZVJlY29yZHMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJlY29yZHMgPSB0aGlzLl9xdWV1ZWRFbnRyaWVzLnNsaWNlKCk7XG4gIHRoaXMuX3F1ZXVlZEVudHJpZXMgPSBbXTtcbiAgcmV0dXJuIHJlY29yZHM7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgdGhyZXNob2xkIHZhbHVlIGZyb20gdGhlIHVzZXIgY29uZmlndXJhdGlvbiBvYmplY3QgYW5kXG4gKiByZXR1cm5zIGEgc29ydGVkIGFycmF5IG9mIHVuaXF1ZSB0aHJlc2hvbGQgdmFsdWVzLiBJZiBhIHZhbHVlIGlzIG5vdFxuICogYmV0d2VlbiAwIGFuZCAxIGFuZCBlcnJvciBpcyB0aHJvd24uXG4gKiBAcHJpdmF0ZVxuICogQHBhcmFtIHtBcnJheXxudW1iZXI9fSBvcHRfdGhyZXNob2xkIEFuIG9wdGlvbmFsIHRocmVzaG9sZCB2YWx1ZSBvclxuICogICAgIGEgbGlzdCBvZiB0aHJlc2hvbGQgdmFsdWVzLCBkZWZhdWx0aW5nIHRvIFswXS5cbiAqIEByZXR1cm4ge0FycmF5fSBBIHNvcnRlZCBsaXN0IG9mIHVuaXF1ZSBhbmQgdmFsaWQgdGhyZXNob2xkIHZhbHVlcy5cbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9pbml0VGhyZXNob2xkcyA9IGZ1bmN0aW9uKG9wdF90aHJlc2hvbGQpIHtcbiAgdmFyIHRocmVzaG9sZCA9IG9wdF90aHJlc2hvbGQgfHwgWzBdO1xuICBpZiAoIUFycmF5LmlzQXJyYXkodGhyZXNob2xkKSkgdGhyZXNob2xkID0gW3RocmVzaG9sZF07XG5cbiAgcmV0dXJuIHRocmVzaG9sZC5zb3J0KCkuZmlsdGVyKGZ1bmN0aW9uKHQsIGksIGEpIHtcbiAgICBpZiAodHlwZW9mIHQgIT0gJ251bWJlcicgfHwgaXNOYU4odCkgfHwgdCA8IDAgfHwgdCA+IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigndGhyZXNob2xkIG11c3QgYmUgYSBudW1iZXIgYmV0d2VlbiAwIGFuZCAxIGluY2x1c2l2ZWx5Jyk7XG4gICAgfVxuICAgIHJldHVybiB0ICE9PSBhW2kgLSAxXTtcbiAgfSk7XG59O1xuXG5cbi8qKlxuICogQWNjZXB0cyB0aGUgcm9vdE1hcmdpbiB2YWx1ZSBmcm9tIHRoZSB1c2VyIGNvbmZpZ3VyYXRpb24gb2JqZWN0XG4gKiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZiB0aGUgZm91ciBtYXJnaW4gdmFsdWVzIGFzIGFuIG9iamVjdCBjb250YWluaW5nXG4gKiB0aGUgdmFsdWUgYW5kIHVuaXQgcHJvcGVydGllcy4gSWYgYW55IG9mIHRoZSB2YWx1ZXMgYXJlIG5vdCBwcm9wZXJseVxuICogZm9ybWF0dGVkIG9yIHVzZSBhIHVuaXQgb3RoZXIgdGhhbiBweCBvciAlLCBhbmQgZXJyb3IgaXMgdGhyb3duLlxuICogQHByaXZhdGVcbiAqIEBwYXJhbSB7c3RyaW5nPX0gb3B0X3Jvb3RNYXJnaW4gQW4gb3B0aW9uYWwgcm9vdE1hcmdpbiB2YWx1ZSxcbiAqICAgICBkZWZhdWx0aW5nIHRvICcwcHgnLlxuICogQHJldHVybiB7QXJyYXk8T2JqZWN0Pn0gQW4gYXJyYXkgb2YgbWFyZ2luIG9iamVjdHMgd2l0aCB0aGUga2V5c1xuICogICAgIHZhbHVlIGFuZCB1bml0LlxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX3BhcnNlUm9vdE1hcmdpbiA9IGZ1bmN0aW9uKG9wdF9yb290TWFyZ2luKSB7XG4gIHZhciBtYXJnaW5TdHJpbmcgPSBvcHRfcm9vdE1hcmdpbiB8fCAnMHB4JztcbiAgdmFyIG1hcmdpbnMgPSBtYXJnaW5TdHJpbmcuc3BsaXQoL1xccysvKS5tYXAoZnVuY3Rpb24obWFyZ2luKSB7XG4gICAgdmFyIHBhcnRzID0gL14oLT9cXGQqXFwuP1xcZCspKHB4fCUpJC8uZXhlYyhtYXJnaW4pO1xuICAgIGlmICghcGFydHMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcigncm9vdE1hcmdpbiBtdXN0IGJlIHNwZWNpZmllZCBpbiBwaXhlbHMgb3IgcGVyY2VudCcpO1xuICAgIH1cbiAgICByZXR1cm4ge3ZhbHVlOiBwYXJzZUZsb2F0KHBhcnRzWzFdKSwgdW5pdDogcGFydHNbMl19O1xuICB9KTtcblxuICAvLyBIYW5kbGVzIHNob3J0aGFuZC5cbiAgbWFyZ2luc1sxXSA9IG1hcmdpbnNbMV0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1syXSA9IG1hcmdpbnNbMl0gfHwgbWFyZ2luc1swXTtcbiAgbWFyZ2luc1szXSA9IG1hcmdpbnNbM10gfHwgbWFyZ2luc1sxXTtcblxuICByZXR1cm4gbWFyZ2lucztcbn07XG5cblxuLyoqXG4gKiBTdGFydHMgcG9sbGluZyBmb3IgaW50ZXJzZWN0aW9uIGNoYW5nZXMgaWYgdGhlIHBvbGxpbmcgaXMgbm90IGFscmVhZHlcbiAqIGhhcHBlbmluZywgYW5kIGlmIHRoZSBwYWdlJ3MgdmlzaWJpbHR5IHN0YXRlIGlzIHZpc2libGUuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX21vbml0b3JJbnRlcnNlY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IHRydWU7XG5cbiAgICB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMoKTtcblxuICAgIC8vIElmIGEgcG9sbCBpbnRlcnZhbCBpcyBzZXQsIHVzZSBwb2xsaW5nIGluc3RlYWQgb2YgbGlzdGVuaW5nIHRvXG4gICAgLy8gcmVzaXplIGFuZCBzY3JvbGwgZXZlbnRzIG9yIERPTSBtdXRhdGlvbnMuXG4gICAgaWYgKHRoaXMuUE9MTF9JTlRFUlZBTCkge1xuICAgICAgdGhpcy5fbW9uaXRvcmluZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoXG4gICAgICAgICAgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0aGlzLlBPTExfSU5URVJWQUwpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIGFkZEV2ZW50KHdpbmRvdywgJ3Jlc2l6ZScsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG4gICAgICBhZGRFdmVudChkb2N1bWVudCwgJ3Njcm9sbCcsIHRoaXMuX2NoZWNrRm9ySW50ZXJzZWN0aW9ucywgdHJ1ZSk7XG5cbiAgICAgIGlmICgnTXV0YXRpb25PYnNlcnZlcicgaW4gd2luZG93KSB7XG4gICAgICAgIHRoaXMuX2RvbU9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIodGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zKTtcbiAgICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIub2JzZXJ2ZShkb2N1bWVudCwge1xuICAgICAgICAgIGF0dHJpYnV0ZXM6IHRydWUsXG4gICAgICAgICAgY2hpbGRMaXN0OiB0cnVlLFxuICAgICAgICAgIGNoYXJhY3RlckRhdGE6IHRydWUsXG4gICAgICAgICAgc3VidHJlZTogdHJ1ZVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cblxuLyoqXG4gKiBTdG9wcyBwb2xsaW5nIGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcy5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fdW5tb25pdG9ySW50ZXJzZWN0aW9ucyA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5fbW9uaXRvcmluZ0ludGVyc2VjdGlvbnMpIHtcbiAgICB0aGlzLl9tb25pdG9yaW5nSW50ZXJzZWN0aW9ucyA9IGZhbHNlO1xuXG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLl9tb25pdG9yaW5nSW50ZXJ2YWwpO1xuICAgIHRoaXMuX21vbml0b3JpbmdJbnRlcnZhbCA9IG51bGw7XG5cbiAgICByZW1vdmVFdmVudCh3aW5kb3csICdyZXNpemUnLCB0aGlzLl9jaGVja0ZvckludGVyc2VjdGlvbnMsIHRydWUpO1xuICAgIHJlbW92ZUV2ZW50KGRvY3VtZW50LCAnc2Nyb2xsJywgdGhpcy5fY2hlY2tGb3JJbnRlcnNlY3Rpb25zLCB0cnVlKTtcblxuICAgIGlmICh0aGlzLl9kb21PYnNlcnZlcikge1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIuZGlzY29ubmVjdCgpO1xuICAgICAgdGhpcy5fZG9tT2JzZXJ2ZXIgPSBudWxsO1xuICAgIH1cbiAgfVxufTtcblxuXG4vKipcbiAqIFNjYW5zIGVhY2ggb2JzZXJ2YXRpb24gdGFyZ2V0IGZvciBpbnRlcnNlY3Rpb24gY2hhbmdlcyBhbmQgYWRkcyB0aGVtXG4gKiB0byB0aGUgaW50ZXJuYWwgZW50cmllcyBxdWV1ZS4gSWYgbmV3IGVudHJpZXMgYXJlIGZvdW5kLCBpdFxuICogc2NoZWR1bGVzIHRoZSBjYWxsYmFjayB0byBiZSBpbnZva2VkLlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl9jaGVja0ZvckludGVyc2VjdGlvbnMgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RJc0luRG9tID0gdGhpcy5fcm9vdElzSW5Eb20oKTtcbiAgdmFyIHJvb3RSZWN0ID0gcm9vdElzSW5Eb20gPyB0aGlzLl9nZXRSb290UmVjdCgpIDogZ2V0RW1wdHlSZWN0KCk7XG5cbiAgdGhpcy5fb2JzZXJ2YXRpb25UYXJnZXRzLmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuICAgIHZhciB0YXJnZXQgPSBpdGVtLmVsZW1lbnQ7XG4gICAgdmFyIHRhcmdldFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGFyZ2V0KTtcbiAgICB2YXIgcm9vdENvbnRhaW5zVGFyZ2V0ID0gdGhpcy5fcm9vdENvbnRhaW5zVGFyZ2V0KHRhcmdldCk7XG4gICAgdmFyIG9sZEVudHJ5ID0gaXRlbS5lbnRyeTtcbiAgICB2YXIgaW50ZXJzZWN0aW9uUmVjdCA9IHJvb3RJc0luRG9tICYmIHJvb3RDb250YWluc1RhcmdldCAmJlxuICAgICAgICB0aGlzLl9jb21wdXRlVGFyZ2V0QW5kUm9vdEludGVyc2VjdGlvbih0YXJnZXQsIHJvb3RSZWN0KTtcblxuICAgIHZhciBuZXdFbnRyeSA9IGl0ZW0uZW50cnkgPSBuZXcgSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSh7XG4gICAgICB0aW1lOiBub3coKSxcbiAgICAgIHRhcmdldDogdGFyZ2V0LFxuICAgICAgYm91bmRpbmdDbGllbnRSZWN0OiB0YXJnZXRSZWN0LFxuICAgICAgcm9vdEJvdW5kczogcm9vdFJlY3QsXG4gICAgICBpbnRlcnNlY3Rpb25SZWN0OiBpbnRlcnNlY3Rpb25SZWN0XG4gICAgfSk7XG5cbiAgICBpZiAoIW9sZEVudHJ5KSB7XG4gICAgICB0aGlzLl9xdWV1ZWRFbnRyaWVzLnB1c2gobmV3RW50cnkpO1xuICAgIH0gZWxzZSBpZiAocm9vdElzSW5Eb20gJiYgcm9vdENvbnRhaW5zVGFyZ2V0KSB7XG4gICAgICAvLyBJZiB0aGUgbmV3IGVudHJ5IGludGVyc2VjdGlvbiByYXRpbyBoYXMgY3Jvc3NlZCBhbnkgb2YgdGhlXG4gICAgICAvLyB0aHJlc2hvbGRzLCBhZGQgYSBuZXcgZW50cnkuXG4gICAgICBpZiAodGhpcy5faGFzQ3Jvc3NlZFRocmVzaG9sZChvbGRFbnRyeSwgbmV3RW50cnkpKSB7XG4gICAgICAgIHRoaXMuX3F1ZXVlZEVudHJpZXMucHVzaChuZXdFbnRyeSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIHRoZSByb290IGlzIG5vdCBpbiB0aGUgRE9NIG9yIHRhcmdldCBpcyBub3QgY29udGFpbmVkIHdpdGhpblxuICAgICAgLy8gcm9vdCBidXQgdGhlIHByZXZpb3VzIGVudHJ5IGZvciB0aGlzIHRhcmdldCBoYWQgYW4gaW50ZXJzZWN0aW9uLFxuICAgICAgLy8gYWRkIGEgbmV3IHJlY29yZCBpbmRpY2F0aW5nIHJlbW92YWwuXG4gICAgICBpZiAob2xkRW50cnkgJiYgb2xkRW50cnkuaXNJbnRlcnNlY3RpbmcpIHtcbiAgICAgICAgdGhpcy5fcXVldWVkRW50cmllcy5wdXNoKG5ld0VudHJ5KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sIHRoaXMpO1xuXG4gIGlmICh0aGlzLl9xdWV1ZWRFbnRyaWVzLmxlbmd0aCkge1xuICAgIHRoaXMuX2NhbGxiYWNrKHRoaXMudGFrZVJlY29yZHMoKSwgdGhpcyk7XG4gIH1cbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGEgdGFyZ2V0IGFuZCByb290IHJlY3QgY29tcHV0ZXMgdGhlIGludGVyc2VjdGlvbiBiZXR3ZWVuIHRoZW5cbiAqIGZvbGxvd2luZyB0aGUgYWxnb3JpdGhtIGluIHRoZSBzcGVjLlxuICogVE9ETyhwaGlsaXB3YWx0b24pOiBhdCB0aGlzIHRpbWUgY2xpcC1wYXRoIGlzIG5vdCBjb25zaWRlcmVkLlxuICogaHR0cHM6Ly93aWNnLmdpdGh1Yi5pby9JbnRlcnNlY3Rpb25PYnNlcnZlci8jY2FsY3VsYXRlLWludGVyc2VjdGlvbi1yZWN0LWFsZ29cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgRE9NIGVsZW1lbnRcbiAqIEBwYXJhbSB7T2JqZWN0fSByb290UmVjdCBUaGUgYm91bmRpbmcgcmVjdCBvZiB0aGUgcm9vdCBhZnRlciBiZWluZ1xuICogICAgIGV4cGFuZGVkIGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHJldHVybiB7P09iamVjdH0gVGhlIGZpbmFsIGludGVyc2VjdGlvbiByZWN0IG9iamVjdCBvciB1bmRlZmluZWQgaWYgbm9cbiAqICAgICBpbnRlcnNlY3Rpb24gaXMgZm91bmQuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2NvbXB1dGVUYXJnZXRBbmRSb290SW50ZXJzZWN0aW9uID1cbiAgICBmdW5jdGlvbih0YXJnZXQsIHJvb3RSZWN0KSB7XG5cbiAgLy8gSWYgdGhlIGVsZW1lbnQgaXNuJ3QgZGlzcGxheWVkLCBhbiBpbnRlcnNlY3Rpb24gY2FuJ3QgaGFwcGVuLlxuICBpZiAod2luZG93LmdldENvbXB1dGVkU3R5bGUodGFyZ2V0KS5kaXNwbGF5ID09ICdub25lJykgcmV0dXJuO1xuXG4gIHZhciB0YXJnZXRSZWN0ID0gZ2V0Qm91bmRpbmdDbGllbnRSZWN0KHRhcmdldCk7XG4gIHZhciBpbnRlcnNlY3Rpb25SZWN0ID0gdGFyZ2V0UmVjdDtcbiAgdmFyIHBhcmVudCA9IGdldFBhcmVudE5vZGUodGFyZ2V0KTtcbiAgdmFyIGF0Um9vdCA9IGZhbHNlO1xuXG4gIHdoaWxlICghYXRSb290KSB7XG4gICAgdmFyIHBhcmVudFJlY3QgPSBudWxsO1xuICAgIHZhciBwYXJlbnRDb21wdXRlZFN0eWxlID0gcGFyZW50Lm5vZGVUeXBlID09IDEgP1xuICAgICAgICB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShwYXJlbnQpIDoge307XG5cbiAgICAvLyBJZiB0aGUgcGFyZW50IGlzbid0IGRpc3BsYXllZCwgYW4gaW50ZXJzZWN0aW9uIGNhbid0IGhhcHBlbi5cbiAgICBpZiAocGFyZW50Q29tcHV0ZWRTdHlsZS5kaXNwbGF5ID09ICdub25lJykgcmV0dXJuO1xuXG4gICAgaWYgKHBhcmVudCA9PSB0aGlzLnJvb3QgfHwgcGFyZW50ID09IGRvY3VtZW50KSB7XG4gICAgICBhdFJvb3QgPSB0cnVlO1xuICAgICAgcGFyZW50UmVjdCA9IHJvb3RSZWN0O1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiB0aGUgZWxlbWVudCBoYXMgYSBub24tdmlzaWJsZSBvdmVyZmxvdywgYW5kIGl0J3Mgbm90IHRoZSA8Ym9keT5cbiAgICAgIC8vIG9yIDxodG1sPiBlbGVtZW50LCB1cGRhdGUgdGhlIGludGVyc2VjdGlvbiByZWN0LlxuICAgICAgLy8gTm90ZTogPGJvZHk+IGFuZCA8aHRtbD4gY2Fubm90IGJlIGNsaXBwZWQgdG8gYSByZWN0IHRoYXQncyBub3QgYWxzb1xuICAgICAgLy8gdGhlIGRvY3VtZW50IHJlY3QsIHNvIG5vIG5lZWQgdG8gY29tcHV0ZSBhIG5ldyBpbnRlcnNlY3Rpb24uXG4gICAgICBpZiAocGFyZW50ICE9IGRvY3VtZW50LmJvZHkgJiZcbiAgICAgICAgICBwYXJlbnQgIT0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50ICYmXG4gICAgICAgICAgcGFyZW50Q29tcHV0ZWRTdHlsZS5vdmVyZmxvdyAhPSAndmlzaWJsZScpIHtcbiAgICAgICAgcGFyZW50UmVjdCA9IGdldEJvdW5kaW5nQ2xpZW50UmVjdChwYXJlbnQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGVpdGhlciBvZiB0aGUgYWJvdmUgY29uZGl0aW9uYWxzIHNldCBhIG5ldyBwYXJlbnRSZWN0LFxuICAgIC8vIGNhbGN1bGF0ZSBuZXcgaW50ZXJzZWN0aW9uIGRhdGEuXG4gICAgaWYgKHBhcmVudFJlY3QpIHtcbiAgICAgIGludGVyc2VjdGlvblJlY3QgPSBjb21wdXRlUmVjdEludGVyc2VjdGlvbihwYXJlbnRSZWN0LCBpbnRlcnNlY3Rpb25SZWN0KTtcblxuICAgICAgaWYgKCFpbnRlcnNlY3Rpb25SZWN0KSBicmVhaztcbiAgICB9XG4gICAgcGFyZW50ID0gZ2V0UGFyZW50Tm9kZShwYXJlbnQpO1xuICB9XG4gIHJldHVybiBpbnRlcnNlY3Rpb25SZWN0O1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJvb3QgcmVjdCBhZnRlciBiZWluZyBleHBhbmRlZCBieSB0aGUgcm9vdE1hcmdpbiB2YWx1ZS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJvb3QgcmVjdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fZ2V0Um9vdFJlY3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIHJvb3RSZWN0O1xuICBpZiAodGhpcy5yb290KSB7XG4gICAgcm9vdFJlY3QgPSBnZXRCb3VuZGluZ0NsaWVudFJlY3QodGhpcy5yb290KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBVc2UgPGh0bWw+Lzxib2R5PiBpbnN0ZWFkIG9mIHdpbmRvdyBzaW5jZSBzY3JvbGwgYmFycyBhZmZlY3Qgc2l6ZS5cbiAgICB2YXIgaHRtbCA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudDtcbiAgICB2YXIgYm9keSA9IGRvY3VtZW50LmJvZHk7XG4gICAgcm9vdFJlY3QgPSB7XG4gICAgICB0b3A6IDAsXG4gICAgICBsZWZ0OiAwLFxuICAgICAgcmlnaHQ6IGh0bWwuY2xpZW50V2lkdGggfHwgYm9keS5jbGllbnRXaWR0aCxcbiAgICAgIHdpZHRoOiBodG1sLmNsaWVudFdpZHRoIHx8IGJvZHkuY2xpZW50V2lkdGgsXG4gICAgICBib3R0b206IGh0bWwuY2xpZW50SGVpZ2h0IHx8IGJvZHkuY2xpZW50SGVpZ2h0LFxuICAgICAgaGVpZ2h0OiBodG1sLmNsaWVudEhlaWdodCB8fCBib2R5LmNsaWVudEhlaWdodFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4ocm9vdFJlY3QpO1xufTtcblxuXG4vKipcbiAqIEFjY2VwdHMgYSByZWN0IGFuZCBleHBhbmRzIGl0IGJ5IHRoZSByb290TWFyZ2luIHZhbHVlLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QgVGhlIHJlY3Qgb2JqZWN0IHRvIGV4cGFuZC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGV4cGFuZGVkIHJlY3QuXG4gKiBAcHJpdmF0ZVxuICovXG5JbnRlcnNlY3Rpb25PYnNlcnZlci5wcm90b3R5cGUuX2V4cGFuZFJlY3RCeVJvb3RNYXJnaW4gPSBmdW5jdGlvbihyZWN0KSB7XG4gIHZhciBtYXJnaW5zID0gdGhpcy5fcm9vdE1hcmdpblZhbHVlcy5tYXAoZnVuY3Rpb24obWFyZ2luLCBpKSB7XG4gICAgcmV0dXJuIG1hcmdpbi51bml0ID09ICdweCcgPyBtYXJnaW4udmFsdWUgOlxuICAgICAgICBtYXJnaW4udmFsdWUgKiAoaSAlIDIgPyByZWN0LndpZHRoIDogcmVjdC5oZWlnaHQpIC8gMTAwO1xuICB9KTtcbiAgdmFyIG5ld1JlY3QgPSB7XG4gICAgdG9wOiByZWN0LnRvcCAtIG1hcmdpbnNbMF0sXG4gICAgcmlnaHQ6IHJlY3QucmlnaHQgKyBtYXJnaW5zWzFdLFxuICAgIGJvdHRvbTogcmVjdC5ib3R0b20gKyBtYXJnaW5zWzJdLFxuICAgIGxlZnQ6IHJlY3QubGVmdCAtIG1hcmdpbnNbM11cbiAgfTtcbiAgbmV3UmVjdC53aWR0aCA9IG5ld1JlY3QucmlnaHQgLSBuZXdSZWN0LmxlZnQ7XG4gIG5ld1JlY3QuaGVpZ2h0ID0gbmV3UmVjdC5ib3R0b20gLSBuZXdSZWN0LnRvcDtcblxuICByZXR1cm4gbmV3UmVjdDtcbn07XG5cblxuLyoqXG4gKiBBY2NlcHRzIGFuIG9sZCBhbmQgbmV3IGVudHJ5IGFuZCByZXR1cm5zIHRydWUgaWYgYXQgbGVhc3Qgb25lIG9mIHRoZVxuICogdGhyZXNob2xkIHZhbHVlcyBoYXMgYmVlbiBjcm9zc2VkLlxuICogQHBhcmFtIHs/SW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeX0gb2xkRW50cnkgVGhlIHByZXZpb3VzIGVudHJ5IGZvciBhXG4gKiAgICBwYXJ0aWN1bGFyIHRhcmdldCBlbGVtZW50IG9yIG51bGwgaWYgbm8gcHJldmlvdXMgZW50cnkgZXhpc3RzLlxuICogQHBhcmFtIHtJbnRlcnNlY3Rpb25PYnNlcnZlckVudHJ5fSBuZXdFbnRyeSBUaGUgY3VycmVudCBlbnRyeSBmb3IgYVxuICogICAgcGFydGljdWxhciB0YXJnZXQgZWxlbWVudC5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFJldHVybnMgdHJ1ZSBpZiBhIGFueSB0aHJlc2hvbGQgaGFzIGJlZW4gY3Jvc3NlZC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5faGFzQ3Jvc3NlZFRocmVzaG9sZCA9XG4gICAgZnVuY3Rpb24ob2xkRW50cnksIG5ld0VudHJ5KSB7XG5cbiAgLy8gVG8gbWFrZSBjb21wYXJpbmcgZWFzaWVyLCBhbiBlbnRyeSB0aGF0IGhhcyBhIHJhdGlvIG9mIDBcbiAgLy8gYnV0IGRvZXMgbm90IGFjdHVhbGx5IGludGVyc2VjdCBpcyBnaXZlbiBhIHZhbHVlIG9mIC0xXG4gIHZhciBvbGRSYXRpbyA9IG9sZEVudHJ5ICYmIG9sZEVudHJ5LmlzSW50ZXJzZWN0aW5nID9cbiAgICAgIG9sZEVudHJ5LmludGVyc2VjdGlvblJhdGlvIHx8IDAgOiAtMTtcbiAgdmFyIG5ld1JhdGlvID0gbmV3RW50cnkuaXNJbnRlcnNlY3RpbmcgP1xuICAgICAgbmV3RW50cnkuaW50ZXJzZWN0aW9uUmF0aW8gfHwgMCA6IC0xO1xuXG4gIC8vIElnbm9yZSB1bmNoYW5nZWQgcmF0aW9zXG4gIGlmIChvbGRSYXRpbyA9PT0gbmV3UmF0aW8pIHJldHVybjtcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudGhyZXNob2xkcy5sZW5ndGg7IGkrKykge1xuICAgIHZhciB0aHJlc2hvbGQgPSB0aGlzLnRocmVzaG9sZHNbaV07XG5cbiAgICAvLyBSZXR1cm4gdHJ1ZSBpZiBhbiBlbnRyeSBtYXRjaGVzIGEgdGhyZXNob2xkIG9yIGlmIHRoZSBuZXcgcmF0aW9cbiAgICAvLyBhbmQgdGhlIG9sZCByYXRpbyBhcmUgb24gdGhlIG9wcG9zaXRlIHNpZGVzIG9mIGEgdGhyZXNob2xkLlxuICAgIGlmICh0aHJlc2hvbGQgPT0gb2xkUmF0aW8gfHwgdGhyZXNob2xkID09IG5ld1JhdGlvIHx8XG4gICAgICAgIHRocmVzaG9sZCA8IG9sZFJhdGlvICE9PSB0aHJlc2hvbGQgPCBuZXdSYXRpbykge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG59O1xuXG5cbi8qKlxuICogUmV0dXJucyB3aGV0aGVyIG9yIG5vdCB0aGUgcm9vdCBlbGVtZW50IGlzIGFuIGVsZW1lbnQgYW5kIGlzIGluIHRoZSBET00uXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSByb290IGVsZW1lbnQgaXMgYW4gZWxlbWVudCBhbmQgaXMgaW4gdGhlIERPTS5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdElzSW5Eb20gPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuICF0aGlzLnJvb3QgfHwgY29udGFpbnNEZWVwKGRvY3VtZW50LCB0aGlzLnJvb3QpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgd2hldGhlciBvciBub3QgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwYXJhbSB7RWxlbWVudH0gdGFyZ2V0IFRoZSB0YXJnZXQgZWxlbWVudCB0byBjaGVjay5cbiAqIEByZXR1cm4ge2Jvb2xlYW59IFRydWUgaWYgdGhlIHRhcmdldCBlbGVtZW50IGlzIGEgY2hpbGQgb2Ygcm9vdC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcm9vdENvbnRhaW5zVGFyZ2V0ID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHJldHVybiBjb250YWluc0RlZXAodGhpcy5yb290IHx8IGRvY3VtZW50LCB0YXJnZXQpO1xufTtcblxuXG4vKipcbiAqIEFkZHMgdGhlIGluc3RhbmNlIHRvIHRoZSBnbG9iYWwgSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgcmVnaXN0cnkgaWYgaXQgaXNuJ3RcbiAqIGFscmVhZHkgcHJlc2VudC5cbiAqIEBwcml2YXRlXG4gKi9cbkludGVyc2VjdGlvbk9ic2VydmVyLnByb3RvdHlwZS5fcmVnaXN0ZXJJbnN0YW5jZSA9IGZ1bmN0aW9uKCkge1xuICBpZiAocmVnaXN0cnkuaW5kZXhPZih0aGlzKSA8IDApIHtcbiAgICByZWdpc3RyeS5wdXNoKHRoaXMpO1xuICB9XG59O1xuXG5cbi8qKlxuICogUmVtb3ZlcyB0aGUgaW5zdGFuY2UgZnJvbSB0aGUgZ2xvYmFsIEludGVyc2VjdGlvbk9ic2VydmVyIHJlZ2lzdHJ5LlxuICogQHByaXZhdGVcbiAqL1xuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLl91bnJlZ2lzdGVySW5zdGFuY2UgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGluZGV4ID0gcmVnaXN0cnkuaW5kZXhPZih0aGlzKTtcbiAgaWYgKGluZGV4ICE9IC0xKSByZWdpc3RyeS5zcGxpY2UoaW5kZXgsIDEpO1xufTtcblxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJlc3VsdCBvZiB0aGUgcGVyZm9ybWFuY2Uubm93KCkgbWV0aG9kIG9yIG51bGwgaW4gYnJvd3NlcnNcbiAqIHRoYXQgZG9uJ3Qgc3VwcG9ydCB0aGUgQVBJLlxuICogQHJldHVybiB7bnVtYmVyfSBUaGUgZWxhcHNlZCB0aW1lIHNpbmNlIHRoZSBwYWdlIHdhcyByZXF1ZXN0ZWQuXG4gKi9cbmZ1bmN0aW9uIG5vdygpIHtcbiAgcmV0dXJuIHdpbmRvdy5wZXJmb3JtYW5jZSAmJiBwZXJmb3JtYW5jZS5ub3cgJiYgcGVyZm9ybWFuY2Uubm93KCk7XG59XG5cblxuLyoqXG4gKiBUaHJvdHRsZXMgYSBmdW5jdGlvbiBhbmQgZGVsYXlzIGl0cyBleGVjdXRpb25nLCBzbyBpdCdzIG9ubHkgY2FsbGVkIGF0IG1vc3RcbiAqIG9uY2Ugd2l0aGluIGEgZ2l2ZW4gdGltZSBwZXJpb2QuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZnVuY3Rpb24gdG8gdGhyb3R0bGUuXG4gKiBAcGFyYW0ge251bWJlcn0gdGltZW91dCBUaGUgYW1vdW50IG9mIHRpbWUgdGhhdCBtdXN0IHBhc3MgYmVmb3JlIHRoZVxuICogICAgIGZ1bmN0aW9uIGNhbiBiZSBjYWxsZWQgYWdhaW4uXG4gKiBAcmV0dXJuIHtGdW5jdGlvbn0gVGhlIHRocm90dGxlZCBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gdGhyb3R0bGUoZm4sIHRpbWVvdXQpIHtcbiAgdmFyIHRpbWVyID0gbnVsbDtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBpZiAoIXRpbWVyKSB7XG4gICAgICB0aW1lciA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGZuKCk7XG4gICAgICAgIHRpbWVyID0gbnVsbDtcbiAgICAgIH0sIHRpbWVvdXQpO1xuICAgIH1cbiAgfTtcbn1cblxuXG4vKipcbiAqIEFkZHMgYW4gZXZlbnQgaGFuZGxlciB0byBhIERPTSBub2RlIGVuc3VyaW5nIGNyb3NzLWJyb3dzZXIgY29tcGF0aWJpbGl0eS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gYWRkIHRoZSBldmVudCBoYW5kbGVyIHRvLlxuICogQHBhcmFtIHtzdHJpbmd9IGV2ZW50IFRoZSBldmVudCBuYW1lLlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm4gVGhlIGV2ZW50IGhhbmRsZXIgdG8gYWRkLlxuICogQHBhcmFtIHtib29sZWFufSBvcHRfdXNlQ2FwdHVyZSBPcHRpb25hbGx5IGFkZHMgdGhlIGV2ZW4gdG8gdGhlIGNhcHR1cmVcbiAqICAgICBwaGFzZS4gTm90ZTogdGhpcyBvbmx5IHdvcmtzIGluIG1vZGVybiBicm93c2Vycy5cbiAqL1xuZnVuY3Rpb24gYWRkRXZlbnQobm9kZSwgZXZlbnQsIGZuLCBvcHRfdXNlQ2FwdHVyZSkge1xuICBpZiAodHlwZW9mIG5vZGUuYWRkRXZlbnRMaXN0ZW5lciA9PSAnZnVuY3Rpb24nKSB7XG4gICAgbm9kZS5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUgfHwgZmFsc2UpO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiBub2RlLmF0dGFjaEV2ZW50ID09ICdmdW5jdGlvbicpIHtcbiAgICBub2RlLmF0dGFjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZW1vdmVzIGEgcHJldmlvdXNseSBhZGRlZCBldmVudCBoYW5kbGVyIGZyb20gYSBET00gbm9kZS5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgRE9NIG5vZGUgdG8gcmVtb3ZlIHRoZSBldmVudCBoYW5kbGVyIGZyb20uXG4gKiBAcGFyYW0ge3N0cmluZ30gZXZlbnQgVGhlIGV2ZW50IG5hbWUuXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmbiBUaGUgZXZlbnQgaGFuZGxlciB0byByZW1vdmUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IG9wdF91c2VDYXB0dXJlIElmIHRoZSBldmVudCBoYW5kbGVyIHdhcyBhZGRlZCB3aXRoIHRoaXNcbiAqICAgICBmbGFnIHNldCB0byB0cnVlLCBpdCBzaG91bGQgYmUgc2V0IHRvIHRydWUgaGVyZSBpbiBvcmRlciB0byByZW1vdmUgaXQuXG4gKi9cbmZ1bmN0aW9uIHJlbW92ZUV2ZW50KG5vZGUsIGV2ZW50LCBmbiwgb3B0X3VzZUNhcHR1cmUpIHtcbiAgaWYgKHR5cGVvZiBub2RlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudCwgZm4sIG9wdF91c2VDYXB0dXJlIHx8IGZhbHNlKTtcbiAgfVxuICBlbHNlIGlmICh0eXBlb2Ygbm9kZS5kZXRhdGNoRXZlbnQgPT0gJ2Z1bmN0aW9uJykge1xuICAgIG5vZGUuZGV0YXRjaEV2ZW50KCdvbicgKyBldmVudCwgZm4pO1xuICB9XG59XG5cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBpbnRlcnNlY3Rpb24gYmV0d2VlbiB0d28gcmVjdCBvYmplY3RzLlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QxIFRoZSBmaXJzdCByZWN0LlxuICogQHBhcmFtIHtPYmplY3R9IHJlY3QyIFRoZSBzZWNvbmQgcmVjdC5cbiAqIEByZXR1cm4gez9PYmplY3R9IFRoZSBpbnRlcnNlY3Rpb24gcmVjdCBvciB1bmRlZmluZWQgaWYgbm8gaW50ZXJzZWN0aW9uXG4gKiAgICAgaXMgZm91bmQuXG4gKi9cbmZ1bmN0aW9uIGNvbXB1dGVSZWN0SW50ZXJzZWN0aW9uKHJlY3QxLCByZWN0Mikge1xuICB2YXIgdG9wID0gTWF0aC5tYXgocmVjdDEudG9wLCByZWN0Mi50b3ApO1xuICB2YXIgYm90dG9tID0gTWF0aC5taW4ocmVjdDEuYm90dG9tLCByZWN0Mi5ib3R0b20pO1xuICB2YXIgbGVmdCA9IE1hdGgubWF4KHJlY3QxLmxlZnQsIHJlY3QyLmxlZnQpO1xuICB2YXIgcmlnaHQgPSBNYXRoLm1pbihyZWN0MS5yaWdodCwgcmVjdDIucmlnaHQpO1xuICB2YXIgd2lkdGggPSByaWdodCAtIGxlZnQ7XG4gIHZhciBoZWlnaHQgPSBib3R0b20gLSB0b3A7XG5cbiAgcmV0dXJuICh3aWR0aCA+PSAwICYmIGhlaWdodCA+PSAwKSAmJiB7XG4gICAgdG9wOiB0b3AsXG4gICAgYm90dG9tOiBib3R0b20sXG4gICAgbGVmdDogbGVmdCxcbiAgICByaWdodDogcmlnaHQsXG4gICAgd2lkdGg6IHdpZHRoLFxuICAgIGhlaWdodDogaGVpZ2h0XG4gIH07XG59XG5cblxuLyoqXG4gKiBTaGltcyB0aGUgbmF0aXZlIGdldEJvdW5kaW5nQ2xpZW50UmVjdCBmb3IgY29tcGF0aWJpbGl0eSB3aXRoIG9sZGVyIElFLlxuICogQHBhcmFtIHtFbGVtZW50fSBlbCBUaGUgZWxlbWVudCB3aG9zZSBib3VuZGluZyByZWN0IHRvIGdldC5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIChwb3NzaWJseSBzaGltbWVkKSByZWN0IG9mIHRoZSBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRCb3VuZGluZ0NsaWVudFJlY3QoZWwpIHtcbiAgdmFyIHJlY3Q7XG5cbiAgdHJ5IHtcbiAgICByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIC8vIElnbm9yZSBXaW5kb3dzIDcgSUUxMSBcIlVuc3BlY2lmaWVkIGVycm9yXCJcbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vV0lDRy9JbnRlcnNlY3Rpb25PYnNlcnZlci9wdWxsLzIwNVxuICB9XG5cbiAgaWYgKCFyZWN0KSByZXR1cm4gZ2V0RW1wdHlSZWN0KCk7XG5cbiAgLy8gT2xkZXIgSUVcbiAgaWYgKCEocmVjdC53aWR0aCAmJiByZWN0LmhlaWdodCkpIHtcbiAgICByZWN0ID0ge1xuICAgICAgdG9wOiByZWN0LnRvcCxcbiAgICAgIHJpZ2h0OiByZWN0LnJpZ2h0LFxuICAgICAgYm90dG9tOiByZWN0LmJvdHRvbSxcbiAgICAgIGxlZnQ6IHJlY3QubGVmdCxcbiAgICAgIHdpZHRoOiByZWN0LnJpZ2h0IC0gcmVjdC5sZWZ0LFxuICAgICAgaGVpZ2h0OiByZWN0LmJvdHRvbSAtIHJlY3QudG9wXG4gICAgfTtcbiAgfVxuICByZXR1cm4gcmVjdDtcbn1cblxuXG4vKipcbiAqIFJldHVybnMgYW4gZW1wdHkgcmVjdCBvYmplY3QuIEFuIGVtcHR5IHJlY3QgaXMgcmV0dXJuZWQgd2hlbiBhbiBlbGVtZW50XG4gKiBpcyBub3QgaW4gdGhlIERPTS5cbiAqIEByZXR1cm4ge09iamVjdH0gVGhlIGVtcHR5IHJlY3QuXG4gKi9cbmZ1bmN0aW9uIGdldEVtcHR5UmVjdCgpIHtcbiAgcmV0dXJuIHtcbiAgICB0b3A6IDAsXG4gICAgYm90dG9tOiAwLFxuICAgIGxlZnQ6IDAsXG4gICAgcmlnaHQ6IDAsXG4gICAgd2lkdGg6IDAsXG4gICAgaGVpZ2h0OiAwXG4gIH07XG59XG5cbi8qKlxuICogQ2hlY2tzIHRvIHNlZSBpZiBhIHBhcmVudCBlbGVtZW50IGNvbnRhaW5zIGEgY2hpbGQgZWxlbW50IChpbmNsdWRpbmcgaW5zaWRlXG4gKiBzaGFkb3cgRE9NKS5cbiAqIEBwYXJhbSB7Tm9kZX0gcGFyZW50IFRoZSBwYXJlbnQgZWxlbWVudC5cbiAqIEBwYXJhbSB7Tm9kZX0gY2hpbGQgVGhlIGNoaWxkIGVsZW1lbnQuXG4gKiBAcmV0dXJuIHtib29sZWFufSBUcnVlIGlmIHRoZSBwYXJlbnQgbm9kZSBjb250YWlucyB0aGUgY2hpbGQgbm9kZS5cbiAqL1xuZnVuY3Rpb24gY29udGFpbnNEZWVwKHBhcmVudCwgY2hpbGQpIHtcbiAgdmFyIG5vZGUgPSBjaGlsZDtcbiAgd2hpbGUgKG5vZGUpIHtcbiAgICBpZiAobm9kZSA9PSBwYXJlbnQpIHJldHVybiB0cnVlO1xuXG4gICAgbm9kZSA9IGdldFBhcmVudE5vZGUobm9kZSk7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5cbi8qKlxuICogR2V0cyB0aGUgcGFyZW50IG5vZGUgb2YgYW4gZWxlbWVudCBvciBpdHMgaG9zdCBlbGVtZW50IGlmIHRoZSBwYXJlbnQgbm9kZVxuICogaXMgYSBzaGFkb3cgcm9vdC5cbiAqIEBwYXJhbSB7Tm9kZX0gbm9kZSBUaGUgbm9kZSB3aG9zZSBwYXJlbnQgdG8gZ2V0LlxuICogQHJldHVybiB7Tm9kZXxudWxsfSBUaGUgcGFyZW50IG5vZGUgb3IgbnVsbCBpZiBubyBwYXJlbnQgZXhpc3RzLlxuICovXG5mdW5jdGlvbiBnZXRQYXJlbnROb2RlKG5vZGUpIHtcbiAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcblxuICBpZiAocGFyZW50ICYmIHBhcmVudC5ub2RlVHlwZSA9PSAxMSAmJiBwYXJlbnQuaG9zdCkge1xuICAgIC8vIElmIHRoZSBwYXJlbnQgaXMgYSBzaGFkb3cgcm9vdCwgcmV0dXJuIHRoZSBob3N0IGVsZW1lbnQuXG4gICAgcmV0dXJuIHBhcmVudC5ob3N0O1xuICB9XG4gIHJldHVybiBwYXJlbnQ7XG59XG5cblxuLy8gRXhwb3NlcyB0aGUgY29uc3RydWN0b3JzIGdsb2JhbGx5Llxud2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyID0gSW50ZXJzZWN0aW9uT2JzZXJ2ZXI7XG53aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXJFbnRyeSA9IEludGVyc2VjdGlvbk9ic2VydmVyRW50cnk7XG5cbn0od2luZG93LCBkb2N1bWVudCkpO1xuIiwiZXhwb3J0IGNvbnN0IGdldERldGFpbHMgPSAoeyBlbGVtZW50IH0pID0+IHtcbiAgcmV0dXJuIHtcbiAgICB2aWV3cG9ydFdpZHRoOiBNYXRoLm1heChkb2N1bWVudC5ib2R5LmNsaWVudFdpZHRoLCB3aW5kb3cuaW5uZXJXaWR0aCksXG4gICAgdmlld3BvcnRIZWlnaHQ6IE1hdGgubWF4KGRvY3VtZW50LmJvZHkuY2xpZW50SGVpZ2h0LCB3aW5kb3cuaW5uZXJIZWlnaHQpLFxuICAgIGVsZW1lbnRXaWR0aDogZWxlbWVudC5jbGllbnRXaWR0aCxcbiAgICBlbGVtZW50SGVpZ2h0OiBlbGVtZW50LmNsaWVudEhlaWdodCxcbiAgICBpZnJhbWVDb250ZXh0OiBpRnJhbWVDb250ZXh0KCksXG4gICAgZm9jdXM6IGlzSW5Gb2N1cygpXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGlzSW5Gb2N1cyA9ICgpID0+IHtcbiAgaWYgKGRvY3VtZW50LmhpZGRlbiAhPT0gJ3VuZGVmaW5lZCcpe1xuICAgIGlmIChkb2N1bWVudC5oaWRkZW4gPT09IHRydWUpe1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmKGlGcmFtZUNvbnRleHQoKSA9PT0gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZih3aW5kb3cuZG9jdW1lbnQuaGFzRm9jdXMpIHtcbiAgICByZXR1cm4gd2luZG93LnRvcC5kb2N1bWVudC5oYXNGb2N1cygpO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59XG5cbmV4cG9ydCBjb25zdCBpRnJhbWVDb250ZXh0ID0gKCkgPT4ge1xuICB0cnkge1xuICAgIGlmKHdpbmRvdy50b3AgPT09IHdpbmRvdykge1xuICAgICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuT05fUEFHRVxuICAgIH1cblxuICAgIGxldCBjdXJXaW4gPSB3aW5kb3csIGxldmVsID0gMDtcbiAgICB3aGlsZShjdXJXaW4ucGFyZW50ICE9PSBjdXJXaW4gJiYgbGV2ZWwgPCAxMDAwKSB7XG4gICAgICBpZihjdXJXaW4ucGFyZW50LmRvY3VtZW50LmRvbWFpbiAhPT0gY3VyV2luLmRvY3VtZW50LmRvbWFpbikge1xuICAgICAgICByZXR1cm4gaUZyYW1lU2VydmluZ1NjZW5hcmlvcy5DUk9TU19ET01BSU5fSUZSQU1FO1xuICAgICAgfVxuXG4gICAgICBjdXJXaW4gPSBjdXJXaW4ucGFyZW50O1xuICAgIH1cbiAgICBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zLlNBTUVfRE9NQUlOX0lGUkFNRTtcbiAgfVxuICBjYXRjaChlKSB7XG4gICAgcmV0dXJuIGlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBpRnJhbWVTZXJ2aW5nU2NlbmFyaW9zID0ge1xuICBPTl9QQUdFOiAnb24gcGFnZScsXG4gIFNBTUVfRE9NQUlOX0lGUkFNRTogJ3NhbWUgZG9tYWluIGlmcmFtZScsXG4gIENST1NTX0RPTUFJTl9JRlJBTUU6ICdjcm9zcyBkb21haW4gaWZyYW1lJ1xufSIsImltcG9ydCBCYXNlVGFjdGljIGZyb20gJy4uL01lYXN1cmVtZW50L01lYXN1cmVtZW50VGFjdGljcy9CYXNlVGFjdGljJztcblxuLy8gZW5zdXJlIHRhY3RpYyBhdGxlYXN0IGhhcyB0aGUgc2FtZSBwcm9wZXJ0aWVzIGFuZCBtZXRob2RzIG9mIEFic3RyYWN0VGltZXJcbmV4cG9ydCBjb25zdCB2YWxpZFRhY3RpYyA9ICh0YWN0aWMpID0+IHtcbiAgY29uc3QgdmFsaWQgPSBcbiAgICB0eXBlb2YgdGFjdGljID09PSAnZnVuY3Rpb24nICYmXG4gICAgT2JqZWN0XG4gICAgICAuZ2V0T3duUHJvcGVydHlOYW1lcyhCYXNlVGFjdGljKVxuICAgICAgLnJlZHVjZSggKHByb3AsIHZhbGlkKSA9PiB2YWxpZCAmJiB0eXBlb2YgdGFjdGljW3Byb3BdID09PSB0eXBlb2YgQmFzZVRhY3RpY1twcm9wXSwgdHJ1ZSk7XG5cbiAgcmV0dXJuIHZhbGlkO1xufTtcblxuZXhwb3J0IGNvbnN0IHZhbGlkYXRlQ3JpdGVyaWEgPSAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSkgPT4ge1xuICBsZXQgaW52YWxpZCA9IGZhbHNlLCByZWFzb25zID0gW107IFxuXG4gIGlmKHR5cGVvZiBpblZpZXdUaHJlc2hvbGQgIT09ICdudW1iZXInIHx8IGluVmlld1RocmVzaG9sZCA+IDEpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ2luVmlld1RocmVzaG9sZCBtdXN0IGJlIGEgbnVtYmVyIGVxdWFsIHRvIG9yIGxlc3MgdGhhbiAxJyk7XG4gIH1cblxuICBpZih0eXBlb2YgdGltZUluVmlldyAhPT0gJ251bWJlcicgfHwgdGltZUluVmlldyA8IDApIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ3RpbWVJblZpZXcgbXVzdCBiZSBhIG51bWJlciBncmVhdGVyIHRvIG9yIGVxdWFsIDAnKTtcbiAgfVxuXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcbn07XG5cbmV4cG9ydCBjb25zdCB2YWxpZGF0ZVN0cmF0ZWd5ID0gKHsgYXV0b3N0YXJ0LCB0YWN0aWNzLCBjcml0ZXJpYSB9KSA9PiB7XG4gIGxldCBpbnZhbGlkID0gZmFsc2UsIHJlYXNvbnMgPSBbXTtcblxuICBpZih0eXBlb2YgYXV0b3N0YXJ0ICE9PSAnYm9vbGVhbicpIHtcbiAgICBpbnZhbGlkID0gdHJ1ZTtcbiAgICByZWFzb25zLnB1c2goJ2F1dG9zdGFydCBtdXN0IGJlIGJvb2xlYW4nKTtcbiAgfVxuXG4gIGlmKCFBcnJheS5pc0FycmF5KHRhY3RpY3MpIHx8IHRhY3RpY3MubGVuZ3RoID09PSAwKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKCd0YWN0aWNzIG11c3QgYmUgYW4gYXJyYXkgY29udGFpbmluZyBhdGxlYXN0IG9uIG1lYXN1cmVtZW50IHRhY3RpY3MnKTtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlQ3JpdGVyaWEoY3JpdGVyaWEpO1xuXG4gIGlmKHZhbGlkYXRlZC5pbnZhbGlkKSB7XG4gICAgaW52YWxpZCA9IHRydWU7XG4gICAgcmVhc29ucy5wdXNoKHZhbGlkYXRlZC5yZWFzb25zKTtcbiAgfVxuXG4gIHJldHVybiB7IGludmFsaWQsIHJlYXNvbnM6IHJlYXNvbnMuam9pbignIHwgJykgfTtcbn07IiwiZXhwb3J0IGNvbnN0IFNUQVJUID0gJ3N0YXJ0JztcbmV4cG9ydCBjb25zdCBTVE9QID0gJ3N0b3AnO1xuZXhwb3J0IGNvbnN0IENIQU5HRSA9ICdjaGFuZ2UnO1xuZXhwb3J0IGNvbnN0IENPTVBMRVRFID0gJ2NvbXBsZXRlJztcbmV4cG9ydCBjb25zdCBVTk1FQVNVUkVBQkxFID0gJ3VubWVhc3VyZWFibGUnO1xuZXhwb3J0IGNvbnN0IElOVklFVyA9ICdpbnZpZXcnO1xuZXhwb3J0IGNvbnN0IE9VVFZJRVcgPSAnb3V0dmlldyc7ICIsImltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuLi9UaW1pbmcvSW5WaWV3VGltZXInO1xuaW1wb3J0IHsgZGVmYXVsdFN0cmF0ZWd5IH0gZnJvbSAnLi9TdHJhdGVnaWVzLyc7XG5pbXBvcnQgeyB2YWxpZFRhY3RpYywgdmFsaWRhdGVTdHJhdGVneSB9IGZyb20gJy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBFbnZpcm9ubWVudCBmcm9tICcuLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgKiBhcyBFdmVudHMgZnJvbSAnLi9FdmVudHMnO1xuXG4vLyBSZXNwb25zaWJsZSBmb3IgY29sbGVjdGluZyBtZWFzdXJlbWVudCBzdHJhdGVneSxcbi8vIHdhdGNoaW5nIGZvciBtZWFzdXJlbWVudCBjaGFuZ2VzLFxuLy8gdHJhY2tpbmcgaG93IGxvbmcgYW4gZWxlbWVudCBpcyB2aWV3YWJsZSBmb3IsXG4vLyBhbmQgbm90aWZ5aW5nIGxpc3RlbmVycyBvZiBjaGFuZ2VzXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZWFzdXJlbWVudEV4ZWN1dG9yIHtcbiAgY29uc3RydWN0b3IoZWxlbWVudCwgc3RyYXRlZ3kgPSB7fSkge1xuICAgIHRoaXMudGltZXJzID0ge307XG4gICAgdGhpcy5fbGlzdGVuZXJzID0geyBzdGFydDogW10sIHN0b3A6IFtdLCBjaGFuZ2U6IFtdLCBjb21wbGV0ZTogW10sIHVubWVhc3VyZWFibGU6IFtdIH07XG4gICAgdGhpcy5lbGVtZW50ID0gZWxlbWVudDtcbiAgICB0aGlzLnN0cmF0ZWd5ID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdFN0cmF0ZWd5LCBzdHJhdGVneSk7XG5cbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVN0cmF0ZWd5KHRoaXMuc3RyYXRlZ3kpO1xuXG4gICAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICAgIHRocm93IHZhbGlkYXRlZC5yZWFzb25zO1xuICAgIH1cblxuICAgIHRoaXMudGFjdGljID0gdGhpcy5fc2VsZWN0VGFjdGljKHRoaXMuc3RyYXRlZ3kudGFjdGljcyk7XG4gICAgXG4gICAgaWYodGhpcy50YWN0aWMpIHtcbiAgICAgIHRoaXMuX2FkZFN1YnNjcmlwdGlvbnModGhpcy50YWN0aWMpO1xuICAgIH0gICBcblxuICAgIGlmKHRoaXMudW5tZWFzdXJlYWJsZSkge1xuICAgICAgLy8gZmlyZSB1bm1lYXN1cmVhYmxlIGFmdGVyIGN1cnJlbnQgSlMgbG9vcCBjb21wbGV0ZXMgXG4gICAgICAvLyBzbyBvcHBvcnR1bml0eSBpcyBnaXZlbiBmb3IgY29uc3VtZXJzIHRvIHByb3ZpZGUgdW5tZWFzdXJlYWJsZSBjYWxsYmFja1xuICAgICAgc2V0VGltZW91dCggKCkgPT4gdGhpcy5fcHVibGlzaChFdmVudHMuVU5NRUFTVVJFQUJMRSwgRW52aXJvbm1lbnQuZ2V0RGV0YWlscyh0aGlzKSksIDApO1xuICAgIH1cbiAgICBlbHNlIGlmKHRoaXMuc3RyYXRlZ3kuYXV0b3N0YXJ0KSB7XG4gICAgICB0aGlzLnRhY3RpYy5zdGFydCgpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXJ0KCkge1xuICAgIHRoaXMudGFjdGljLnN0YXJ0KCk7XG4gIH1cblxuICBvblZpZXdhYmxlU3RhcnQoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5TVEFSVCk7XG4gIH1cblxuICBvblZpZXdhYmxlU3RvcChjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLlNUT1ApO1xuICB9XG5cbiAgb25WaWV3YWJsZUNoYW5nZShjYWxsYmFjaykge1xuICAgIHJldHVybiB0aGlzLl9hZGRDYWxsYmFjayhjYWxsYmFjaywgRXZlbnRzLkNIQU5HRSk7XG4gIH1cblxuICBvblZpZXdhYmxlQ29tcGxldGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5DT01QTEVURSk7XG4gIH1cblxuICBvblVubWVhc3VyZWFibGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gdGhpcy5fYWRkQ2FsbGJhY2soY2FsbGJhY2ssIEV2ZW50cy5VTk1FQVNVUkVBQkxFKTtcbiAgfVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAhdGhpcy50YWN0aWMgfHwgdGhpcy50YWN0aWMudW5tZWFzdXJlYWJsZTtcbiAgfVxuXG4gIC8vIHNlbGVjdCBmaXJzdCB0YWN0aWMgdGhhdCBpcyBub3QgdW5tZWFzdXJlYWJsZVxuICBfc2VsZWN0VGFjdGljKHRhY3RpY3MpIHtcbiAgICByZXR1cm4gdGFjdGljc1xuICAgICAgICAgICAgLmZpbHRlcih2YWxpZFRhY3RpYylcbiAgICAgICAgICAgIC5tYXAodGhpcy5faW5zdGFudGlhdGVUYWN0aWMuYmluZCh0aGlzKSlcbiAgICAgICAgICAgIC5maW5kKHRhY3RpYyA9PiAhdGFjdGljLnVubWVhc3VyZWFibGUpO1xuICB9XG5cbiAgX2luc3RhbnRpYXRlVGFjdGljKHRhY3RpYykge1xuICAgIHJldHVybiBuZXcgdGFjdGljKGVsZW1lbnQsIHRoaXMuc3RyYXRlZ3kuY3JpdGVyaWEpO1xuICB9XG5cbiAgX2FkZFN1YnNjcmlwdGlvbnModGFjdGljKSB7XG4gICAgaWYodGFjdGljKSB7XG4gICAgICB0YWN0aWMub25JblZpZXcodGhpcy5fdGFjdGljQ2hhbmdlLmJpbmQodGhpcywgRXZlbnRzLklOVklFVywgdGFjdGljKSk7XG4gICAgICB0YWN0aWMub25DaGFuZ2VWaWV3KHRoaXMuX3RhY3RpY0NoYW5nZS5iaW5kKHRoaXMsIEV2ZW50cy5DSEFOR0UsIHRhY3RpYykpO1xuICAgICAgdGFjdGljLm9uT3V0Vmlldyh0aGlzLl90YWN0aWNDaGFuZ2UuYmluZCh0aGlzLCBFdmVudHMuT1VUVklFVywgdGFjdGljKSk7XG4gICAgfVxuICB9XG5cbiAgX3RhY3RpY0NoYW5nZShjaGFuZ2UsIHRhY3RpYykge1xuICAgIGxldCBldmVudE5hbWU7XG4gICAgY29uc3QgZGV0YWlscyA9IHRoaXMuX2FwcGVuZEVudmlyb25tZW50KHRhY3RpYyk7XG5cbiAgICBzd2l0Y2goY2hhbmdlKSB7XG4gICAgICBjYXNlIEV2ZW50cy5JTlZJRVc6XG4gICAgICAgIHRoaXMudGltZXIgPSBuZXcgSW5WaWV3VGltZXIodGhpcy5zdHJhdGVneS5jcml0ZXJpYS50aW1lSW5WaWV3KTtcbiAgICAgICAgdGhpcy50aW1lci5lbGFwc2VkKHRoaXMuX3RpbWVyRWxhcHNlZC5iaW5kKHRoaXMsIHRhY3RpYykpO1xuICAgICAgICB0aGlzLnRpbWVyLnN0YXJ0KCk7XG4gICAgICAgIGV2ZW50TmFtZSA9IEV2ZW50cy5TVEFSVDtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLkNIQU5HRTpcbiAgICAgICAgZXZlbnROYW1lID0gY2hhbmdlO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSBFdmVudHMuQ09NUExFVEU6XG4gICAgICAgIGV2ZW50TmFtZSA9IGNoYW5nZTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgRXZlbnRzLk9VVFZJRVc6XG4gICAgICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgICAgICB0aGlzLnRpbWVyLnN0b3AoKTtcbiAgICAgICAgICBkZWxldGUgdGhpcy50aW1lcjtcbiAgICAgICAgfVxuICAgICAgICBldmVudE5hbWUgPSBFdmVudHMuU1RPUDtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgdGhpcy5fcHVibGlzaChldmVudE5hbWUsIGRldGFpbHMpO1xuICB9XG5cbiAgX3B1Ymxpc2goZXZlbnQsIHZhbHVlKSB7XG4gICAgaWYoQXJyYXkuaXNBcnJheSh0aGlzLl9saXN0ZW5lcnNbZXZlbnRdKSkge1xuICAgICAgdGhpcy5fbGlzdGVuZXJzW2V2ZW50XS5mb3JFYWNoKCBsID0+IGwodmFsdWUpICk7XG4gICAgfVxuICB9XG5cbiAgX3RpbWVyRWxhcHNlZCh0YWN0aWMpIHtcbiAgICB0aGlzLl90YWN0aWNDaGFuZ2UoRXZlbnRzLkNPTVBMRVRFLCB0YWN0aWMpO1xuICB9XG5cbiAgX2FkZENhbGxiYWNrKGNhbGxiYWNrLCBldmVudCkge1xuICAgIGlmKHRoaXMuX2xpc3RlbmVyc1tldmVudF0gJiYgdHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzLl9saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ0NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbic7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBfYXBwZW5kRW52aXJvbm1lbnQodGFjdGljKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIHsgcGVyY2VudFZpZXdhYmxlOiB0YWN0aWMucGVyY2VudFZpZXdhYmxlLCB0YWN0aWM6IHRhY3RpYy50YWN0aWNOYW1lIH0sIEVudmlyb25tZW50LmdldERldGFpbHModGhpcykgKTtcbiAgfVxufSIsImV4cG9ydCBkZWZhdWx0IGNsYXNzIEJhc2VUYWN0aWMge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLmxpc3RlbmVycyA9IHtcbiAgICAgIGluVmlldzpbXSxcbiAgICAgIG91dFZpZXc6W11cbiAgICB9O1xuXG4gICAgdGhpcy5wZXJjZW50Vmlld2FibGUgPSAwLjA7XG4gIH1cblxuICAvLyBlbGVtZW50IGlzIGluIHZpZXcgYWNjb3JkaW5nIHRvIHN0cmF0ZWd5IGRlZmluZWQgYnkgY29uY3JldGUgbWVhc3VyZW1lbnQgY2xhc3NcbiAgb25JblZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnaW5WaWV3Jyk7XG4gIH1cblxuICBvbkNoYW5nZVZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwndmlld0NoYW5nZScpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBubyBsb25nZXIgaW4gdmlld1xuICBvbk91dFZpZXcoY2IpIHtcbiAgICByZXR1cm4gdGhpcy5hZGRDYWxsYmFjayhjYiwnb3V0VmlldycpO1xuICB9XG5cbiAgYWRkQ2FsbGJhY2soY2FsbGJhY2ssIGV2ZW50KSB7XG4gICAgaWYodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nICYmIHRoaXMubGlzdGVuZXJzW2V2ZW50XSkge1xuICAgICAgdGhpcy5saXN0ZW5lcnNbZXZlbnRdLnB1c2goY2FsbGJhY2spO1xuICAgIH1cbiAgICBlbHNlIGlmKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgJ2NhbGxiYWNrIG11c3QgYmUgZnVuY3Rpb24nO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgZ2V0IHVubWVhc3VyZWFibGUoKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufSIsImltcG9ydCBCYXNlVGFjdGljICBmcm9tICcuL0Jhc2VUYWN0aWMnO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBJbnRlcnNlY3Rpb25PYnNlcnZlciBleHRlbmRzIEJhc2VUYWN0aWMge1xuICBjb25zdHJ1Y3RvcihlbGVtZW50LCBjcml0ZXJpYSkge1xuICAgIHN1cGVyKGVsZW1lbnQsIGNyaXRlcmlhKTtcbiAgICBpZihjcml0ZXJpYSAhPT0gdW5kZWZpbmVkICYmIGVsZW1lbnQpIHtcbiAgICAgIHRoaXMuZWxlbWVudCA9IGVsZW1lbnQ7XG4gICAgICB0aGlzLmNyaXRlcmlhID0gY3JpdGVyaWE7XG4gICAgICB0aGlzLmluVmlldyA9IGZhbHNlO1xuICAgICAgdGhpcy5zdGFydGVkID0gZmFsc2U7XG4gICAgfVxuICAgIGVsc2UgaWYoIWVsZW1lbnQpIHtcbiAgICAgIHRocm93ICdlbGVtZW50IG5vdCBwcm92aWRlZCc7XG4gICAgfSBcbiAgICBlbHNlIGlmKCFjcml0ZXJpYSkge1xuICAgICAgdGhyb3cgJ2NyaXRlcmlhIG5vdCBwcm92aWRlZCc7XG4gICAgfVxuICB9XG5cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5vYnNlcnZlciA9IG5ldyB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIodGhpcy52aWV3YWJsZUNoYW5nZS5iaW5kKHRoaXMpLHsgdGhyZXNob2xkOiB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCB9KTtcbiAgICB0aGlzLm9ic2VydmVyLm9ic2VydmUodGhpcy5lbGVtZW50KTtcbiAgfVxuXG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiAoXG4gICAgICAgICF3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIgfHwgXG4gICAgICAgIHR5cGVvZiB3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXIucHJvdG90eXBlLlRIUk9UVExFX1RJTUVPVVQgPT09ICdudW1iZXInXG4gICAgICApICYmIFxuICAgICAgdGhpcy5lbGVtZW50LnRvU3RyaW5nKCkuaW5kZXhPZignRWxlbWVudCcpID4gLTE7IC8vIGVuc3VyZSBpbnRlcnNlY3Rpb24gb2JzZXJ2ZXIgaXMgYXZhaWxhYmxlIGFuZCBlbGVtZW50IGlzIGFuIGFjdHVhbCBlbGVtZW50IGFuZCBub3QgYSBwcm94eVxuICB9XG5cbiAgZ2V0IHZpZXdhYmxlKCkge1xuICAgIHJldHVybiB0aGlzLmluVmlldztcbiAgfVxuXG4gIGdldCB0YWN0aWNOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXInO1xuICB9XG5cbiAgdmlld2FibGVDaGFuZ2UoZW50cmllcykge1xuICAgIGlmKGVudHJpZXMgJiYgZW50cmllcy5sZW5ndGggJiYgZW50cmllc1swXS5pbnRlcnNlY3Rpb25SYXRpbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLnBlcmNlbnRWaWV3YWJsZSA9IGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW87XG4gICAgICBcbiAgICAgIGlmKGVudHJpZXNbMF0uaW50ZXJzZWN0aW9uUmF0aW8gPCB0aGlzLmNyaXRlcmlhLmluVmlld1RocmVzaG9sZCAmJiB0aGlzLnN0YXJ0ZWQpIHtcbiAgICAgICAgdGhpcy5pblZpZXcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMub3V0Vmlldy5mb3JFYWNoKCBsID0+IGwodGhpcy5wZXJjZW50Vmlld2FibGUpICk7XG4gICAgICB9XG4gICAgICBpZihlbnRyaWVzWzBdLmludGVyc2VjdGlvblJhdGlvID49IHRoaXMuY3JpdGVyaWEuaW5WaWV3VGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMuc3RhcnRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuaW5WaWV3ID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMuaW5WaWV3LmZvckVhY2goIGwgPT4gbCh0aGlzLnBlcmNlbnRWaWV3YWJsZSkgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxufSIsImltcG9ydCBJbnRlcnNlY3Rpb25PYnNlcnZlciBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyJztcbmltcG9ydCBQb2x5ZmlsbCBmcm9tICdpbnRlcnNlY3Rpb24tb2JzZXJ2ZXInO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi4vLi4vRW52aXJvbm1lbnQvRW52aXJvbm1lbnQnO1xuXG4vLyBXZSBvbmx5IG5lZWQgdG8gb3ZlcnJpZGUgYSBmZXcgYXNwZWN0cyBvZiB0aGUgbmF0aXZlIGltcGxlbWVudGF0aW9uJ3MgbWVhc3VyZXJcbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgZXh0ZW5kcyBJbnRlcnNlY3Rpb25PYnNlcnZlciB7XG4gIGdldCB1bm1lYXN1cmVhYmxlKCkge1xuICAgIHJldHVybiBFbnZpcm9ubWVudC5pRnJhbWVDb250ZXh0KCkgPT09IEVudmlyb25tZW50LmlGcmFtZVNlcnZpbmdTY2VuYXJpb3MuQ1JPU1NfRE9NQUlOX0lGUkFNRTtcbiAgfVxuXG4gIGdldCB0YWN0aWNOYW1lKCkge1xuICAgIHJldHVybiAnSW50ZXJzZWN0aW9uT2JzZXJ2ZXJQb2x5RmlsbCc7XG4gIH1cbn0iLCJleHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyIH0gZnJvbSAnLi9JbnRlcnNlY3Rpb25PYnNlcnZlcic7XG5leHBvcnQgeyBkZWZhdWx0IGFzIEludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwgfSBmcm9tICcuL0ludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGwnO1xuZXhwb3J0IHsgZGVmYXVsdCBhcyBCYXNlVGFjdGljIH0gZnJvbSAnLi9CYXNlVGFjdGljJzsiLCJpbXBvcnQgKiBhcyBWYWxpZGF0b3JzIGZyb20gJy4uLy4uL0hlbHBlcnMvVmFsaWRhdG9ycyc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRhY3RpY3MgZnJvbSAnLi4vTWVhc3VyZW1lbnRUYWN0aWNzLyc7XG5pbXBvcnQgKiBhcyBWaWV3YWJpbGl0eUNyaXRlcmlhIGZyb20gJy4uLy4uL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5cbmV4cG9ydCBjb25zdCBkZWZhdWx0U3RyYXRlZ3kgPSB7XG4gIGF1dG9zdGFydDogdHJ1ZSxcbiAgdGFjdGljczogW01lYXN1cmVtZW50VGFjdGljcy5JbnRlcnNlY3Rpb25PYnNlcnZlciwgTWVhc3VyZW1lbnRUYWN0aWNzLkludGVyc2VjdGlvbk9ic2VydmVyUG9seWZpbGxdLFxuICBjcml0ZXJpYTogVmlld2FiaWxpdHlDcml0ZXJpYS5NUkNfVklERU9cbn07XG5cbmV4cG9ydCBjb25zdCBTdHJhdGVneUZhY3RvcnkgPSAoYXV0b3N0YXJ0ID0gZGVmYXVsdFN0cmF0ZWd5LmF1dG9zdGFydCwgdGFjdGljcyA9IGRlZmF1bHRTdHJhdGVneS50YWN0aWNzLCBjcml0ZXJpYSA9IGRlZmF1bHRTdHJhdGVneS5jcml0ZXJpYSkgPT4ge1xuICBjb25zdCBzdHJhdGVneSA9IHsgYXV0b3N0YXJ0LCB0YWN0aWNzLCBjcml0ZXJpYSB9LFxuICAgICAgICB2YWxpZGF0ZWQgPSBWYWxpZGF0b3JzLnZhbGlkYXRlU3RyYXRlZ3koc3RyYXRlZ3kpOyAgXG5cbiAgaWYodmFsaWRhdGVkLmludmFsaWQpIHtcbiAgICB0aHJvdyB2YWxpZGF0ZWQucmVhc29ucztcbiAgfVxuXG4gIHJldHVybiBzdHJhdGVneTtcbn07IiwiaW1wb3J0ICogYXMgRXZlbnRzIGZyb20gJy4vTWVhc3VyZW1lbnQvRXZlbnRzJztcbmltcG9ydCBJblZpZXdUaW1lciBmcm9tICcuL1RpbWluZy9JblZpZXdUaW1lcic7XG5pbXBvcnQgKiBhcyBTdHJhdGVnaWVzIGZyb20gJy4vTWVhc3VyZW1lbnQvU3RyYXRlZ2llcy8nO1xuaW1wb3J0ICogYXMgRW52aXJvbm1lbnQgZnJvbSAnLi9FbnZpcm9ubWVudC9FbnZpcm9ubWVudCc7XG5pbXBvcnQgTWVhc3VyZW1lbnRFeGVjdXRvciBmcm9tICcuL01lYXN1cmVtZW50L01lYXN1cmVtZW50RXhlY3V0b3InO1xuaW1wb3J0ICogYXMgVmlld2FiaWxpdHlDcml0ZXJpYSBmcm9tICcuL09wdGlvbnMvVmlld2FiaWxpdHlDcml0ZXJpYSc7XG5pbXBvcnQgKiBhcyBNZWFzdXJlbWVudFRhY3RpY3MgZnJvbSAnLi9NZWFzdXJlbWVudC9NZWFzdXJlbWVudFRhY3RpY3MvJztcblxuLy8gTWFpbiBlbnRyeSBwb2ludFxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgT3BlblZWIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgdGhpcy5leGVjdXRvcnMgPSBbXTtcbiAgfVxuXG4gIG1lYXN1cmVFbGVtZW50KGVsZW1lbnQsIHN0cmF0ZWd5KSB7XG4gICAgY29uc3QgZXhlY3V0b3IgPSBuZXcgTWVhc3VyZW1lbnRFeGVjdXRvcihlbGVtZW50LCBzdHJhdGVneSk7XG4gICAgdGhpcy5leGVjdXRvcnMucHVzaChleGVjdXRvcik7XG4gICAgcmV0dXJuIGV4ZWN1dG9yO1xuICB9IFxufVxuXG4vLyBFeHBvc2Ugc3VwcG9ydCBjbGFzc2VzIC8gY29uc3RhbnRzXG5PcGVuVlYuVmlld2FiaWxpdHlDcml0ZXJpYSA9IFZpZXdhYmlsaXR5Q3JpdGVyaWE7XG5PcGVuVlYuTWVhc3VyZW1lbnRFeGVjdXRvciA9IE1lYXN1cmVtZW50RXhlY3V0b3I7XG5PcGVuVlYuTWVhc3VyZW1lbnRUYWN0aWNzID0gTWVhc3VyZW1lbnRUYWN0aWNzO1xuT3BlblZWLkluVmlld1RpbWVyID0gSW5WaWV3VGltZXI7XG5PcGVuVlYuU3RyYXRlZ2llcyA9IFN0cmF0ZWdpZXM7XG5PcGVuVlYuRXZlbnRzID0gRXZlbnRzOyIsImV4cG9ydCBjb25zdCBNUkNfVklERU8gPSB7XG4gIGluVmlld1RocmVzaG9sZDogMC41LFxuICB0aW1lSW5WaWV3OiAyMDAwXG59O1xuXG5leHBvcnQgY29uc3QgTVJDX0RJU1BMQVkgPSB7XG4gIGluVmlld1RocmVzaG9sZDogMC41LFxuICB0aW1lSW5WaWV3OiAxMDAwXG59O1xuXG5leHBvcnQgY29uc3QgY3VzdG9tQ3JpdGVyaWEgPSAoaW5WaWV3VGhyZXNob2xkLCB0aW1lSW5WaWV3KSA9PiAoeyBpblZpZXdUaHJlc2hvbGQsIHRpbWVJblZpZXcgfSk7IiwiZXhwb3J0IGRlZmF1bHQgY2xhc3MgSW5WaWV3VGltZXIge1xuICBjb25zdHJ1Y3RvcihkdXJhdGlvbikge1xuICAgIHRoaXMuZHVyYXRpb24gPSBkdXJhdGlvbjsgICAgICBcbiAgICB0aGlzLmxpc3RlbmVycyA9IFtdO1xuICAgIHRoaXMuY29tcGxldGVkID0gZmFsc2U7XG4gIH1cblxuICB0aW1lckNvbXBsZXRlKCkge1xuICAgIHRoaXMuY29tcGxldGVkID0gdHJ1ZTtcbiAgICB0aGlzLmxpc3RlbmVycy5mb3JFYWNoKCBsID0+IGwoKSApO1xuICB9XG5cbiAgZWxhcHNlZChjYikge1xuICAgIGlmKHR5cGVvZiBjYiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpcy5saXN0ZW5lcnMucHVzaChjYik7XG4gICAgfVxuICB9XG5cbiAgc3RhcnQoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIHN0b3AoKSB7XG4gICAgdGhpcy5lbmRUaW1lcigpO1xuICB9XG5cbiAgcGF1c2UoKSB7XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMudGltZXIpO1xuICB9XG5cbiAgcmVzdW1lKCkge1xuICAgIHRoaXMudGltZXIgPSBzZXRUaW1lb3V0KHRoaXMudGltZXJDb21wbGV0ZS5iaW5kKHRoaXMpLCB0aGlzLmR1cmF0aW9uKTtcbiAgfVxuXG4gIGVuZFRpbWVyKCkge1xuICAgIGlmKHRoaXMudGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnRpbWVyKTtcbiAgICAgIHRoaXMubGlzdGVuZXJzLmxlbmd0aCA9IDA7XG4gICAgfVxuICB9XG5cbn0iXX0=
