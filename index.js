module.exports = function(options = {}) {

  const {
    fetchExternalSpecs,
    validateReferences,
    findExternalSpecByKey,
    mergeCustomRefs
  } = require('./references.js');
  const gulp = require('gulp');
  const fs = require('fs-extra');
  const path = require('path');
  const findPkgDir = require('find-pkg-dir');
  const modulePath = findPkgDir(__dirname);
  let config = fs.readJsonSync('./specs.json');
  let assets = fs.readJsonSync(modulePath + '/src/asset-map.json');
  let externalReferences;
  let references = [];
  let definitions = [];

  const katexRules = ['math_block', 'math_inline']
  const replacerRegex = /\[\[\s*([^\s\[\]:]+):?\s*([^\]\n]+)?\]\]/img;
  const replacerArgsRegex = /\s*,+\s*/;
  const replacers = [
    {
      test: 'insert',
      transform: function(path){
        if (!path) return '';
        return fs.readFileSync(path, 'utf8');
      }
    }
  ];

  function applyReplacers(doc){
    return doc.replace(replacerRegex, function(match, type, args){
      let replacer = replacers.find(r => type.trim().match(r.test));
      return replacer ? replacer.transform(...args.trim().split(replacerArgsRegex)) : match;
    });
  }

  function normalizePath(path){
    return path.trim().replace(/\/$/g, '') + '/';
  }

  function renderRefGroup(type){
    let group = specGroups[type];
    if (!group) return '';
    let html = Object.keys(group).sort().reduce((html, name) => {
      let ref = group[name];
      return html += `
        <dt id="ref:${name}">${name}</dt>
        <dd>
          <cite><a href="${ref.href}">${ref.title}</a></cite>. 
          ${ref.authors.join('; ')}; ${ref.rawDate}. <span class="reference-status">Status: ${ref.status}</span>.
        </dd>
      `;
    }, '<dl class="reference-list">')
    return `\n${html}\n</dl>\n`;
  }

  function findKatexDist(){
    const relpath = "node_modules/katex/dist";
    const paths = [
      path.join(process.cwd(), relpath),
      path.join(__dirname, relpath),
    ];
    for(const abspath of paths) {
      if(fs.existsSync(abspath)) {
        return abspath
      }
    }
    throw Error("katex distribution could not be located");
  }

  try {

    var toc;
    var specGroups = {};
    const noticeTypes = {
      note: 1,
      issue: 1,
      example: 1,
      warning: 1,
      todo: 1
    };
    const spaceRegex = /\s+/g;
    const specNameRegex = /^spec$|^spec[-]*\w+$/i;
    const terminologyRegex = /^def$|^ref$|^xref/i;
    const specCorpus = fs.readJsonSync(modulePath + '/assets/compiled/refs.json');
    const containers = require('markdown-it-container');
    const md = require('markdown-it')({
        html: true,
        linkify: true,
        typographer: true
      })
      .use(require('./src/markdown-it-extensions.js'), [
        {
          filter: type => type.match(terminologyRegex),
          parse(token, type, primary){
            if (!primary) return;
            if (type === 'def'){
              definitions.push(token.info.args);
              return token.info.args.reduce((acc, syn) => {
                return `<span id="term:${syn.replace(spaceRegex, '-').toLowerCase()}">${acc}</span>`;
              }, primary);
            }
            else if (type === 'xref') {
              const url = findExternalSpecByKey(config, token.info.args[0]);
              const term = token.info.args[1].replace(spaceRegex, '-').toLowerCase();
              return `<a class="term-reference" data-local-href="#term:${token.info.args[0]}:${term}"
                href="${url}#term:${term}">${token.info.args[1]}</a>`;
            }
            else {
              references.push(primary);
              return `<a class="term-reference" href="#term:${primary.replace(spaceRegex, '-').toLowerCase()}">${primary}</a>`;
            }
          }
        },
        {
          filter: type => type.match(specNameRegex),
          parse(token, type, name){
            if (name) {
              let _name = name.replace(spaceRegex, '-').toUpperCase();
              let spec = specCorpus[_name] ||
                         specCorpus[_name.toLowerCase()] || 
                         specCorpus[name.toLowerCase()] || 
                         specCorpus[name];
              if (spec) {
                spec._name = _name;
                let group = specGroups[type] = specGroups[type] || {};
                token.info.spec = group[_name] = spec;
              }
            }
          },
          render(token, type, name){
            if (name){
              let spec = token.info.spec;
              if (spec) return `[<a class="spec-reference" href="#ref:${spec._name}">${spec._name}</a>]`;
            }
            else return renderRefGroup(type);
          }
        }
      ])
      .use(require('markdown-it-attrs'))
      .use(require('markdown-it-chart').default)
      .use(require('markdown-it-deflist'))
      .use(require('markdown-it-references'))
      .use(require('markdown-it-icons').default, 'font-awesome')
      .use(require('markdown-it-ins'))
      .use(require('markdown-it-mark'))
      .use(require('markdown-it-textual-uml'))
      .use(require('markdown-it-sub'))
      .use(require('markdown-it-sup'))
      .use(require('markdown-it-task-lists'))
      .use(require('markdown-it-multimd-table'), {
        multiline:  true,
        rowspan:    true,
        headerless: true
      })
      .use(containers, 'notice', {
        validate: function(params) {
          let matches = params.match(/(\w+)\s?(.*)?/);
          return matches && noticeTypes[matches[1]];
        },
        render: function (tokens, idx) {
          let matches = tokens[idx].info.match(/(\w+)\s?(.*)?/);
          if (matches && tokens[idx].nesting === 1) {
            let id;
            let type = matches[1];
            if (matches[2]) {
              id = matches[2].trim().replace(/\s+/g , '-').toLowerCase();
              if (noticeTitles[id]) id += '-' + noticeTitles[id]++;
              else noticeTitles[id] = 1;
            }
            else id = type + '-' + noticeTypes[type]++;
            return `<div id="${id}" class="notice ${type}"><a class="notice-link" href="#${id}">${type.toUpperCase()}</a>`;
          }
          else return '</div>\n';
        }
      })
      .use(require('markdown-it-prism'))
      .use(require('markdown-it-toc-and-anchor').default, {
        tocClassName: 'toc',
        tocFirstLevel: 2,
        tocLastLevel: 4,
        tocCallback: (_md, _tokens, html) => toc = html,
        anchorLinkSymbol: '§',
        anchorClassName: 'toc-anchor'
      })
      .use(require('@traptitech/markdown-it-katex'))

    async function render(spec, assets) {
      try {
        noticeTitles = {};
        specGroups = {};
        console.log('Rendering: ' + spec.title);
        return new Promise(async (resolve, reject) => {
          Promise.all((spec.markdown_paths || ['spec.md']).map(_path => {
            return fs.readFile(spec.spec_directory + _path, 'utf8').catch(e => reject(e))
          })).then(async docs => {
            const features = (({ source, logo }) => ({ source, logo }))(spec);
            if (spec.external_specs) {
              mergeCustomRefs(spec.external_specs, specCorpus);
              if (!externalReferences) {
                externalReferences = await fetchExternalSpecs(spec);
              }
            }
            let doc = docs.join("\n");
            doc = applyReplacers(doc);
            md[spec.katex ? "enable" : "disable"](katexRules);
            const render = md.render(doc);
            fs.writeFile(path.join(spec.destination, 'index.html'), `
              <!DOCTYPE html>
              <html lang="en">
                <head>
                  <meta charset="utf-8">
                  <meta http-equiv="X-UA-Compatible" content="IE=edge">
                  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
      
                  <title>${spec.title}</title>

                  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400&display=swap" rel="stylesheet">

                  ${assets.head}
                </head>
                <body features="${Object.keys(features).join(' ')}">
                  
                  ${assets.svg}
      
                  <main>
      
                    <header id="header" class="panel-header">
                      <span id="toc_toggle" panel-toggle="toc">
                        <svg icon><use xlink:href="#svg-nested-list"></use></svg>
                      </span>
                      <a id="logo" href="${spec.logo_link ? spec.logo_link : '#_'}">
                        <img src="${spec.logo}" />
                      </a>
                      <span issue-count animate panel-toggle="repo_issues">
                        <svg icon><use xlink:href="#svg-github"></use></svg>
                      </span>
                    </header>
      
                    <article id="content">
                      ${render}
                    </article>    
      
                  </main>
      
                  <slide-panels id="slidepanels">
                    <slide-panel id="repo_issues" options="right">
                      <header class="panel-header">
                        <span>
                          <svg icon><use xlink:href="#svg-github"></use></svg>
                          <span issue-count></span>
                        </span>
                        <span class="repo-issue-toggle" panel-toggle="repo_issues">✕</span>
                      </header>
                      <ul id="repo_issue_list"></ul>
                    </slide-panel>
      
                    <slide-panel id="toc">
                      <header class="panel-header">
                        <span>Table of Contents</span>
                        <span panel-toggle="toc">✕</span>
                      </header>
                      <div id="toc_list">
                        ${toc}
                      </div>
                    </slide-panel>
                    
                  </slide-panels>
                  <div style="display: none;">
                    ${externalReferences}
                  </div>
                </body>
                <script>window.specConfig = ${JSON.stringify(spec)}</script>
                ${assets.body}
              </html>
            `, function(err, data){
              if (err) {
                reject(err);
              }
              else {
                resolve();
              }
            });
            validateReferences(references, definitions, render);
            references = [];
            definitions = [];
          });
        });
      }
      catch(e) {
        console.error(e);
      }
    }

    config.specs.forEach(spec => {
      spec.spec_directory = normalizePath(spec.spec_directory);    
      spec.destination = normalizePath(spec.output_path || spec.spec_directory);

      fs.ensureDirSync(spec.destination);

      let assetTags = {
        svg: fs.readFileSync(modulePath + '/assets/icons.svg', 'utf8') || ''
      };

      let customAssets = (spec.assets || []).reduce((assets, asset) => {
        let ext = asset.path.split('.').pop();
        if (ext === 'css') {
          assets.css += `<link href="${asset.path}" rel="stylesheet"/>`;
        }
        if (ext === 'js') {
          assets.js[asset.inject || 'body'] += `<script src="${asset.path}" ${ asset.module ? 'type="module"' : '' } ></script>`;
        }
        return assets;
      }, {
        css: '',
        js: { head: '', body: '' }
      });  

      if (options.dev) {
        assetTags.head = assets.head.css.map(_path => `<link href="${_path}" rel="stylesheet"/>`).join('') + 
                         customAssets.css +
                         assets.head.js.map(_path =>  `<script src="${_path}"></script>`).join('') +
                         customAssets.js.head;
        assetTags.body = assets.body.js.map(_path => `<script src="${_path}" data-manual></script>`).join('') + 
                         customAssets.js.body;
      }
      else {
        assetTags.head = `
          <style>${fs.readFileSync(modulePath + '/assets/compiled/head.css', 'utf8')}</style>
          ${ customAssets.css }
          <script>${fs.readFileSync(modulePath + '/assets/compiled/head.js', 'utf8')}</script>
          ${ customAssets.js.head }
        `;
        assetTags.body = `<script>${fs.readFileSync(modulePath + '/assets/compiled/body.js', 'utf8')}</script>
                          ${ customAssets.js.body }`;
      }

      if (spec.katex) {
        const katexDist = findKatexDist();
        assetTags.body += `<script>/* katex */${fs.readFileSync(path.join(katexDist, 'katex.min.js'),
                          'utf8')}</script>`;
        assetTags.body += `<style>/* katex */${fs.readFileSync(path.join(katexDist, 'katex.min.css'),
                          'utf8')}</style>`;
        
        fs.copySync(path.join(katexDist, 'fonts'), path.join(spec.destination, 'fonts'));
      }

      if (!options.nowatch) {
        gulp.watch(
          [spec.spec_directory + '**/*', '!' + path.join(spec.destination, 'index.html')],
          render.bind(null, spec, assetTags)
        )
      }

      render(spec, assetTags).then(() => {
        if (options.nowatch) process.exit(0)
      }).catch(() => process.exit(1));

    });

  }
  catch(e) {
    console.error(e);
  }

}
