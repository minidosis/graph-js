
const { graph } = require('./graph')

const show = (id) => {
  const node = graph.get(id)
  console.log(node.content)
}

show('sql-update')