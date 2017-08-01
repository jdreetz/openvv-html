import * as Tactics from '../Tactics/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';

export const defaultStrategy = {
  autostart: true,
  tactics: [Tactics.IntersectionObserver, Tactics.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};