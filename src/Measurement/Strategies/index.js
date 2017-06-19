import * as Measureables from '../Measureables/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';
import * as Rules from './rules';

export const defaultStrategy = () => ({
  autostart: true,
  rule: Rules.ANY,
  measureables: [Measureables.IntersectionObserverMeasureable, Measureables.IOPolyFillMeasureable],
  criteria: ViewabilityCriteria.MRC_VIDEO
});