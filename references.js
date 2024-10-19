const {JSDOM} = require("jsdom");
const axios = require('axios').default;
  
const spaceRegex = /\s+/g;

function validateReferences(references, definitions, render) {
  const resolvedRefs = [];
  const unresolvedRefs = [];
  [...new Set(references)].forEach(
    ref => {
      if(render.includes(`id="term:${ref.replace(spaceRegex, '-').toLowerCase()}"`)) {
        resolvedRefs.push(ref);
      } else {
        unresolvedRefs.push(ref);
      }
    }
  );
  if (unresolvedRefs.length > 0 ) {
    console.log('Unresolved References: ', unresolvedRefs)
  }
  
  const danglingDefs = [];
  definitions.forEach(defs => {
    let found = defs.some(def => render.includes(`href="#term:${def.replace(spaceRegex, '-').toLowerCase()}"`)) 
    if (!found) {
      danglingDefs.push(defs[0]);
    }
  })
  if(danglingDefs.length > 0) {
    console.log('Dangling Definitions: ', danglingDefs)
  }
}

function findExternalSpecByKey(config, key) {
  for (const spec of config.specs) {
    if (spec.external_specs) {
      for (const externalSpec of spec.external_specs) {
        if (externalSpec[key]) {
          return externalSpec[key];
        }
      }
    }
  }
  return null;
}

async function fetchExternalSpecs(spec){
  try {
    let results = await Promise.all(
      spec.external_specs.map(s => {
        if (typeof Object.values(s)[0] === 'string') {
          const url = Object.values(s)[0];
          return axios.get(url);
        } else {
          return null;
        }
      })
    );
    results = results.filter(r => r !== null).map((r, index) => (r.status === 200 ? { [Object.keys(spec.external_specs[index])[0]]: r.data } : null)).filter(r_1 => r_1);
    return results.map(r_2 => createNewDLWithTerms(Object.keys(r_2)[0], Object.values(r_2)[0]));
  } catch (e) {
    return console.log(e);
  }
}

function createNewDLWithTerms(title, html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const newDl = document.createElement('dl');
  newDl.setAttribute('id', title);

  const terms = document.querySelectorAll('dt span[id^="term:"]');

  terms.forEach(term => {
    const modifiedId = `term:${title}:${term.id.split(':')[1]}`;
    term.id = modifiedId;
    const dt = term.closest('dt');
    const dd = dt.nextElementSibling;

    newDl.appendChild(dt.cloneNode(true));
    if (dd && dd.tagName === 'DD') {
      newDl.appendChild(dd.cloneNode(true));
    }
  });

  return newDl.outerHTML;
}

function mergeCustomRefs(externalSpecs, specCorpus) {
  externalSpecs.forEach(extSpec => {
    const key = Object.keys(extSpec)[0];
    const value = extSpec[key];
    if (typeof value === 'object') {
      const requiredParams = ['authors', 'href', 'title', 'rawDate'];
      const missingParams = requiredParams.filter(param => !value[param]);
      
      if (missingParams.length === 0) {
        specCorpus[key] = {
          authors: value.authors,
          href: value.href,
          title: value.title,
          rawDate: value.rawDate,
          status: value.status || 'N/A'
        };
      } else {
        console.warn(`Invalid custom reference for ${key}. Missing parameters: ${missingParams.join(', ')}`);
      }
    }
  });
}

module.exports = {
  findExternalSpecByKey,
  validateReferences,
  fetchExternalSpecs,
  createNewDLWithTerms,
  mergeCustomRefs
}
