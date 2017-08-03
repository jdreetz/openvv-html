import IntersectionObserver from './IntersectionObserver';
import Polyfill from 'intersection-observer';
import * as Environment from '../../Environment/Environment';

// We only need to override a few aspects of the native implementation's measurer
export default class IntersectionObserverPolyfill extends IntersectionObserver {
  get unmeasureable() {
    return Environment.iFrameContext() === Environment.iFrameServingScenarios.CROSS_DOMAIN_IFRAME;
  }

  get tacticName() {
    return 'IntersectionObserverPolyFill';
  }
}