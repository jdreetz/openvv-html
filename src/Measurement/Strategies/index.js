import * as Measureables from '../Measureables/';
import * as ViewabilityCriteria from '../../Options/ViewabilityCriteria';
import { TECHNIQUE_PREFERNCE, UNMEASUREABLE_PREFERENCE } from './rules';

export const defaultStrategy = {
  autostart: true,
  technique_preference: TECHNIQUE_PREFERNCE.FIRST_MEASUREABLE,
  unmeasureable_rule: UNMEASUREABLE_PREFERENCE.ALL_UNMEASUREABLE,
  measureables: [Measureables.IntersectionObserverMeasureable, Measureables.IOPolyFillMeasureable],
  criteria: ViewabilityCriteria.MRC_VIDEO
};