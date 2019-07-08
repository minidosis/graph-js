
const path = require('path')
const fs = require('fs')
const sha1 = require('sha1')
const markright = require('@minidosis/markright')

const GRAPH_DIR = process.env.MINIDOSIS_GRAPH
if (!GRAPH_DIR) {
  throw Error('MINIDOSIS_GRAPH directory not defined!')
}

const LinkTypeArray = ['None', 'Base', 'Derived', 'Child', 'Parent', 'Related']
const listName = {
  Base: 'bases', Derived: 'derived',
  Child: 'children', Parent: 'parents',
  Related: 'related',
}
const LinkType = LinkTypeArray.reduce((typ, val) => { typ[val] = val; return typ; }, {})

class Node {
  constructor(id) {
    this.id = id
    this.bases = new Set()
    this.derived = new Set()
    this.parents = new Set()
    this.children = new Set()
    this.related = new Set()
  }

  addBase(id) { this.bases.add(id) }
  addParent(id) { this.parents.add(id) }
  addChild(id) { this.children.add(id) }
  addDerived(id) { this.derived.add(id) }
  addRelated(id) { this.related.add(id) }

  setFilename(filename) { this.filename = filename }

  clearLinks() { this.links = new Map() }

  addLink(type, id) {
    switch (type) {
      case 'Base': this.addBase(id); break;
      case 'Derived': this.addDerived(id); break;
      case 'Child': this.addChild(id); break;
      case 'Parent': this.addParent(id); break;
      case 'Related': this.addRelated(id); break;
      default: throw new Error('unknown link type: ' + type);
    }
  }

  addLinks(type, idlist) { 
    idlist.forEach(id => this.addLink(type, id)) 
  }

  show() {
    const $ = (s) => console.log(s)
    const links = { Base: [], Child: [], Related: [] }
    this.links.forEach((type, id) => {
      if (type in links) {
        links[type].push(id)
      }
    })

    $(`${this.id} {`)
    if (this.title) {
      $(`  title: "${this.title}"`)
    }
    for (let idlist in links) {
      if (links[idlist].length > 0) {
        $(`  ${listName[idlist]}: { ${links[idlist].join(' ')} }`)
      }
    }
    $(`}\n`)
  }

  toJson() {
    const node = { ...this };
    for (let linkset of ['bases', 'derived', 'parents', 'children', 'related']) {
      if (linkset in node) {
        node[linkset] = Array.from(node[linkset])
          .map(id => ({ id, title: graph.get(id).title }));
      }
    }
    return JSON.stringify(node);
  }
}

class Graph {
  has(id) { return this.nodes.has(id) }
  hasImage(id) { return this.images.has(id) }

  get(id, filename) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, new Node(id))
    }
    if (filename) {
      this.nodes.get(id).setFilename(filename)
    }
    return this.nodes.get(id);
  }

  getImage(id) { return this.images.get(id) }

  forEachNode(callback) {
    this.nodes.forEach((node, id) => callback(id, node));
  }

  numNodes() {
    return this.nodes.size;
  }

  addNode(filename, id, { title, bases, children, related }, content) {
    const node = this.get(id, filename);
    node.title = title
    node.content = content

    const add_links = (links, type, inverseType) => {
      if (links) {
        node.addLinks(type, links)
        links.forEach(other => this.get(other).addLink(inverseType, id))
      }
    }

    add_links(bases, LinkType.Base, LinkType.Derived)
    add_links(children, LinkType.Child, LinkType.Parent)
    add_links(related, LinkType.Related, LinkType.Related)
  }

  show() {
    this.nodes.forEach(node => node.show())
  }

  getImageHash(base_dir, imgpath) {
    const abspath = path.join(base_dir, imgpath)
    const hash = sha1(fs.readFileSync(abspath))
    this.images.set(hash, abspath)
    return hash
  }

  pathToHash(fullPath) {
    return ({ children }) => {
      try {
        const base_path = path.dirname(fullPath)
        const hash = this.getImageHash(base_path, children[0])
        return { id: 'img', children: [hash] }
      }
      catch (e) {
        const msg = `Failed to update image '${children[0]}' in node '${fullPath}':`
        console.error('updateNode:', msg, e.toString())
        return { id: 'img', children: msg }
      }
    }
  }

  readFile(dir, filename) {
    const fullPath = path.join(dir, filename)
    const textContent = String(fs.readFileSync(fullPath))
    const minidosisID = filename.split('.')[0]
    const [first, ...content] = markright.parse(textContent, {
      img: this.pathToHash(fullPath),
    });

    if (!markright.isCommandNode(first, 'graph')) {
      throw Error(`File '${fullPath} does not have a 'graph' node!`)
    } 
    else {
      const header = markright.toJson(first.children)
      const commaSplit = x => {
        if (x in header) {
          header[x] = header[x].trim().split(/\s+/)
        }
      }
      ['bases', 'children', 'related'].map(commaSplit)
      this.addNode(fullPath, minidosisID, header, content)
    }
  }

  readAll() {
    this.nodes = new Map()
    this.images = new Map()

    const parseDir = (dir) => {
      let files = fs.readdirSync(dir, { withFileTypes: true })
      // depth first
      const directories = files.filter(f => f.isDirectory() && !f.name.startsWith('.'))
      for (let subdir of directories) {
        parseDir(dir + '/' + subdir.name)
      }
      const minidosis_files = files.filter(f => f.name.endsWith('.minidosis'))
      for (let file of minidosis_files) {
        try {
          this.readFile(dir, file.name)
        } catch (e) {
          console.error(`Error reading ${file.name}: ${e.toString()}`)
        }

      }
    }
    parseDir(GRAPH_DIR)
  }

  watchForChanges() {
    const watchDir = (dir) => {
      let files = fs.readdirSync(dir, { withFileTypes: true })
      const dirs = files.filter(f => f.isDirectory() && !f.name.startsWith('.'))
      for (let d of dirs) {
        const subdir = dir + '/' + d.name
        fs.watch(subdir, () => this.readAll())
        watchDir(subdir)
      }
    }
    watchDir(GRAPH_DIR)
  }

  search(query) {
    const upperQuery = query.toUpperCase()
    const results = []
    this.forEachNode((_, node) => {
      if (node.title && node.title.toUpperCase().indexOf(upperQuery) !== -1) {
        results.push(node)
      }
    })
    return results
  }
}

const graph = new Graph()

module.exports = { graph }
