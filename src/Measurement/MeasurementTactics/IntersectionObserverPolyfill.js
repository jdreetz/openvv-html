import IntersectionObserver from './IntersectionObserver';
import Polyfill from 'intersection-observer';
import * as Environment from '../../Environment/Environment';

// We only need to override a few aspects of the native implementation's measurer
export default class IntersectionObserverPolyfill extends IntersectionObserver {
  start() {
    this.observer = new Polyfill(this.viewableChange.bind(this),{ threshold: criteria.inViewThreshold });
    this.observer.observe(this.element);
  }

  get unmeasureable() {
    return Environment.iFrameContext() !== Environment.servingScenarios.CROSS_DOMAIN_IFRAME;
  }

}