import core from './core.js'
import Vector from './lib/Vector.js'
import DependencyGraph from './lib/DependencyGraph.js'

class Environment {
  constructor(parent) {
    this.vars = Object.create(parent ? parent.vars : null)
    this.state = Object.create(parent ? parent.state : null)
    this.dependencies = parent ? parent.dependencies : new DependencyGraph()
    if (!parent) this.loadCore()
    this.parent = parent
    this.handlers = []
    this.dirtyState = new Set()
    this.isRecalculating = false
  }

  loadCore() {
    core(this).forEach(item => {
      this.def(item[0], item[1])
    })
  }

  needsRecalculation() {
    return this.dirtyState.size > 0
  }

  has(name) {
    return (name in this.vars || name in this.state)
  }

  def(name, value) {
    if (name in this.vars) throw new Error(`${name} is already assigned. (${JSON.stringify(this.vars[name])})`)

    this.vars[name] = value
  }

  set(name, body) {
    if (this.parent) throw new Error(`Let is only allowed in the root scope. Use const instead.`)
    const evaluated = evaluate(body, this)
    if (!(name in this.state)) {
      this.state[name] = evaluated
    } else {
      this.state[name] = evaluated
      this.dependencies.dependantsOf(name).forEach(i => this.dirtyState.add(i))
      if (!this.isRecalculating) this.recalculateState()
    }

    this.dependencies.addNode(name, body)

    return evaluated
  }

  watch(name, vars, body) {
    if (!name in this.state) throw new Error('Unknow watcher')

    // Purge any existing dependencies
    // This should keep the dependency tree clean at all times
    this.dependencies.removeDependencies(name) 

    vars.forEach(v => {
      this.dependencies.addDependency(name, v)
    })
  }

  recalculateState() {
    this.isRecalculating = true
    while (this.needsRecalculation()) {
      for (let name of this.dirtyState) {
        this.set(name, this.dependencies.getNode(name))
        this.dirtyState.delete(name) 
      }
    }
    this.isRecalculating = false
  }

  get(name) {
    if (name in this.vars) {
      const val = this.vars[name] || null
      return val
    } else if (name in this.state) {
      const val = this.state[name]
      return val
    }
    throw new Error(`Undefined variable ${name}`)
  }

  onRender(fn) {
    this.handlers.push(fn)
  }

  render(tree) {
    this.handlers.forEach(item => item.call(null, tree))
  }
}

const evaluate = (exp, env) => {
  if (!exp) return null

  const makeFunction = (vars, body) => {
    return function() {
      const scope = new Environment(env)
      for (let i = 0; i < vars.length; i++) {
        scope.def(vars[i], i < arguments.length ? arguments[i] : false)
      }
      return(evaluate(body, scope))
    }
  }

  switch (exp.type) {
    case 'NumberLiteral':
    case 'ColorLiteral':
    case 'StringLiteral':
      return exp.value
    case 'List':
      return [...(exp.values.map(val => evaluate(val, env)))]
    case 'Vector':
      if (exp.values.length !== 2) throw new Error('Only two dimensional vectors are supported')

      const x = evaluate(exp.values[0], env)
      const y = evaluate(exp.values[1], env)

      return new Vector(x, y)
    case 'Map':
      const map = {}
      for (let i = 0; i < exp.values.length;) {
        const key = evaluate(exp.values[i], env)
        const val = evaluate(exp.values[++i], env) || null
        map[key] = val
        i++
      } 
      return map
    // Anonymous Function
    case 'Function':
      return makeFunction(exp.params[0].values.map(i => i.value), exp.params[1])
    // Named Function (syntactic sugar)  
    // 
    // equivalent to (const name (fn [] (...)))
    case 'NamedFunction':
      return env.def(exp.name, makeFunction(exp.params[0].values.map(i => i.value), exp.params[1]))
    case 'Condition':
      const condition = evaluate(exp.params[0], env)
      const then = exp.params[1]
      return condition ? evaluate(then, env) : (!!exp.params[2] ? evaluate(exp.params[2], env) : false)
    case 'Variable':
      return env.get(exp.value)
    case 'Program':
      let val = false
      exp.params.forEach((e) => { val = evaluate(e, env) }) 
      return val
    case 'ConstAssignment':
      return env.def(exp.name, evaluate(exp.params[0], env))
    case 'StateAssignment':
      const isObserving = exp.params[0].type === 'List'
      const name = exp.name  
      const vars = isObserving ? exp.params[0].values.map(i => i.value) : []
      const body = isObserving ? exp.params[1] : exp.params[0]
      const value = evaluate(body, new Environment(env))
      env.set(exp.name, body, true)
      if (isObserving) env.watch(exp.name, vars, body)
      return value
    case 'CallExpression':
      const func = env.get(exp.name)
      return func.apply(null, exp.params.map((arg) => evaluate(arg, env)))
    case 'Symbol':
      return exp.value.substring(1)
    case 'ExposedParameter':
      return evaluate(exp.params[0], env)
    default:
      return null
  }
}

export {
  Environment,
  evaluate
}
