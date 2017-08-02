import * as MeasurementTactics from '../MeasurementTactics/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';

export const defaultStrategy = {
  autostart: true,
  tactics: [MeasurementTactics.IntersectionObserver, MeasurementTactics.IntersectionObserverPolyfill],
  criteria: ViewabilityCriteria.MRC_VIDEO
};