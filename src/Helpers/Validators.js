import BaseTechnique from '../Measurement/MeasurementTechniques/BaseTechnique';

// ensure technique atleast has the same properties and methods of AbstractTimer
export const validTechnique = (technique) => {
  const valid = 
    typeof technique === 'function' &&
    Object
      .getOwnPropertyNames(BaseTechnique)
      .reduce( (prop, valid) => valid && typeof technique[prop] === typeof BaseTechnique[prop], true);

  return valid;
};

export const validElement = (element) => {
  return element && element.toString().indexOf('Element') > -1;
};

export const validateCriteria = ({ inViewThreshold, timeInView }) => {
  let invalid = false, reasons = []; 

  if(typeof inViewThreshold !== 'number' || inViewThreshold > 1) {
    invalid = true;
    reasons.push('inViewThreshold must be a number equal to or less than 1');
  }

  if(typeof timeInView !== 'number' || timeInView < 0) {
    invalid = true;
    reasons.push('timeInView must be a number greater to or equal 0');
  }

  return { invalid, reasons: reasons.join(' | ') };
};

export const validateStrategy = ({ autostart, techniques, criteria }) => {
  let invalid = false, reasons = [];

  if(typeof autostart !== 'boolean') {
    invalid = true;
    reasons.push('autostart must be boolean');
  }

  if(!Array.isArray(techniques) || techniques.length === 0) {
    invalid = true;
    reasons.push('techniques must be an array containing atleast on measurement techniques');
  }

  const validated = validateCriteria(criteria);

  if(validated.invalid) {
    invalid = true;
    reasons.push(validated.reasons);
  }

  return { invalid, reasons: reasons.join(' | ') };
};