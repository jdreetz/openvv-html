// Filters measurement techniques according to selected rule
export const TECHNIQUE_PREFERENCE = {
  // select the first measurement technique that is not unmeasureable
  // order of techniques provided is relevant
  FIRST_MEASUREABLE: measureables => {
    if(valid(measureables)) {
      let selected;

      measureables.forEach( m => selected = selected || (!m.unmeasureable ? m : undefined) );

      return selected;
    }
  },
  // select all techniques that are not unmeasureable
  ALL_MEASUREABLE: measureables => valid(measureables) && measureables.filter( m => !m.unmeasureable)
}

// Determines whether a set of measurement techniques is unmeasureable according to the selected rule 
export const UNMEASUREABLE_PREFERENCE = {
  // if any measurement techniques are unmeasureable, return true
  ANY_UNMEASUREABLE: measureables => valid(measureables) && measureables.reduce( (unmeasureable, m) =>  m.unmeasureable || unmeasureable, false),
  // if all measurement techniques are unmeasureable, return true 
  ALL_UNMEASUREABLE: measureables => valid(measureables) && measureables.reduce( (unmeasureable, m) =>  m.unmeasureable && unmeasureable, true)
}

function valid(m) {
  return Array.isArray(m) && m.length;
}