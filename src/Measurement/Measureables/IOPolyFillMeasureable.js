import IntersectionObserverMeasureable from './IntersectionObserverMeasureable';
import IOPolyFill from 'intersection-observer';

// We only need to override a few aspects of the native implementation's measurer
export default class IOPolyFillMeasureable extends IntersectionObserverMeasureable {
  start() {
    this.observer = new IOPolyFill(this.viewableChange.bind(this),{ threshold: criteria.inViewThreshold });
    this.observer.observe(this.element);
  }

  get unmeasureable() {
    return window.top !== window;
  }

}