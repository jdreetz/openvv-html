import * as Measurers from './Measurers/';
import * as ViewableStrategies from './Strategies/';
import * as ViewabilityCriteria from '../Options/ViewabilityCriteria';

export const defaultStrategy = {
  measurers:[Measurers.IntersectionObserverMeasurer, Measurers.IOPolyFillMeasurer],
  viewableStrategy: ViewableStrategies.ALL_VIEWABLE,
  criteria: ViewabilityCriteria.MRC_VIDEO
};

export const MeasureableElementDefaults = {};
export const MeasurementMonitorDefaults = {};