
const fs = require('fs')
const sha1 = require('sha1')
const { parseFile, parseAllFiles } = require('./parser')
const markright = require('../markright')

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
    this.links = new Map()
  }

  setFilename(filename) { this.filename = filename }

  clearLinks() { this.links = new Map() }

  addLink(type, id) { this.links.set(id, type) }
  addLinks(type, idlist) { idlist.forEach(id => this.addLink(type, id)) }

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
    for (let type in LinkType) {
      node[listName[type]] = [];
    }
    this.links.forEach((type, id) => {
      node[listName[type]].push({ id, title: graph.get(id).title })
    })
    return JSON.stringify(node);
  }
}

class Graph {
  constructor() {
    this.readAll()
  }

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

  getImageHash(path) {
    const abspath = GRAPH_DIR + '/' + path
    const hash = sha1(fs.readFileSync(abspath))
    this.images.set(hash, abspath)
    return hash
  }

  updateNode(filename, minidosisName, header, contentString) {
    const content = markright.parse(contentString, {
      img: ({ args, children: path }) => ({
        id: 'img', children: [this.getImageHash(path[0])]
      })
    })
    this.addNode(GRAPH_DIR + '/' + filename, minidosisName, header, content)
  }

  readFile(filename) {
    parseFile(GRAPH_DIR, filename, this.updateNode.bind(this))
  }

  readAll() {
    this.nodes = new Map()
    this.images = new Map()
    parseAllFiles(GRAPH_DIR, this.updateNode.bind(this))
  }
}

const graph = new Graph()

const rereadGraph = (event, filename) => {
  try {
    console.log('re-read graph')
    graph.readAll()
  } catch (e) {
    console.error("graph.readAll error:", e)
  }
}

const watchDir = (root) => {
  let files = fs.readdirSync(root, { withFileTypes: true })
  const dirs = files.filter(f => f.isDirectory() && !f.name.startsWith('.'))
  for (let d of dirs) {
    const subdir = root + '/' + d.name
    fs.watch(subdir, rereadGraph)
    watchDir(subdir)
  }
}

watchDir(GRAPH_DIR)

module.exports = { graph }

