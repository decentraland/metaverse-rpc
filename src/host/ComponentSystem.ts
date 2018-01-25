import { Dictionary } from '../common/core/EventDispatcher'
import { WebWorkerServer } from './WebWorkerServer'
import { ComponentClass, Component, ComponentOptions } from './Component'

// If there is no native Symbol
// nor polyfill, then a plain number is used for performance.
const hasSymbol = typeof Symbol === 'function' && Symbol.for

const componentNameSymbol: any = hasSymbol ? Symbol('pluginName') : 0xfea2

const registeredComponents: Dictionary<ComponentClass<Component>> = {}

namespace PrivateHelpers {
  export function _registerComponent(
    componentName: string,
    api: ComponentClass<Component>
  ) {
    if (componentNameSymbol in api) {
      throw new Error(
        `The API you are trying to register is already registered`
      )
    }

    if (componentName in registeredComponents) {
      throw new Error(`The API ${componentName} is already registered`)
    }

    if (typeof (api as any) !== 'function') {
      throw new Error(
        `The API ${componentName} is not a class, it is of type ${typeof api}`
      )
    }

    // save the registered name
    // tslint:disable-next-line:semicolon
    ;(api as any)[componentNameSymbol] = componentName

    registeredComponents[componentName] = api
  }

  export function unmountComponent(component: Component) {
    if (component.componentWillUnmount) {
      const promise = component.componentWillUnmount()
      if (promise && 'catch' in promise) {
        promise.catch(error =>
          console.error('Error unmounting component', { component, error })
        )
      }
    }
  }

  export function mountComponent(component: Component) {
    if (component.componentDidMount) {
      const promise = component.componentDidMount()
      if (promise && 'catch' in promise) {
        promise.catch(error =>
          console.error('Error mounting component', { component, error })
        )
      }
    }
  }
}

// HERE WE START THE EXPORTS

export enum ComponentSystemEvents {
  systemWillUnmount = 'systemWillUnmount',
  systemWillEnable = 'systemWillEnable',
  systemDidUnmount = 'systemDidUnmount'
}

export function getComponentName(
  klass: ComponentClass<Component>
): string | null {
  return (klass as any)[componentNameSymbol] || null
}

export function registerComponent(
  componentName: string
): (klass: ComponentClass<Component>) => void {
  return function(api: ComponentClass<Component>) {
    PrivateHelpers._registerComponent(componentName, api)
  }
}

export class ComponentSystem extends WebWorkerServer {
  componentInstances: Map<string, Component> = new Map()

  private constructor(worker: Worker) {
    super(worker)

    this.expose('LoadComponents', this.RPCLoadComponents.bind(this))
  }

  static async fromWorker(worker: Worker) {
    return new ComponentSystem(worker)
  }

  static async fromURL(url: string) {
    const worker = new Worker(url)

    return ComponentSystem.fromWorker(worker)
  }

  static async fromBlob(blob: Blob) {
    const worker = new Worker(window.URL.createObjectURL(blob))

    return ComponentSystem.fromWorker(worker)
  }

  /**
   * This methdod should be called only from the interface that manages the COmponentSystems.
   * It initializes the system and it's queued components. It also sends a first notification
   * to the implementation of the system telling it is now enabled. In that moment, the
   * implementation will send the queued messages and execute the queued methods against the
   * materialized components.
   *
   * It:
   *  1) emits a ComponentSystemEvents.systemWillEnable event
   *  2) mounts all the components
   *  3) sends the notification to the actual system implementation
   */
  enable() {
    this.emit(ComponentSystemEvents.systemWillEnable)
    this.componentInstances.forEach(PrivateHelpers.mountComponent)
    super.enable()
  }

  /**
   * This is a service locator, it locates or instantiate the requested component
   * for this instance of ComponentSystem.
   *
   * @param component A class constructor
   */
  getComponentInstance<X>(component: { new (options: ComponentOptions): X }): X

  /**
   * This is a service locator, it locates or instantiate the requested component
   * for this instance of ComponentSystem.
   *
   * @param name The name of used to register the component
   */
  getComponentInstance(name: string): Component | null

  getComponentInstance(component: any) {
    if (typeof component === 'string') {
      if (this.componentInstances.has(component)) {
        return this.componentInstances.get(component)
      }
      if (component in registeredComponents) {
        return this.initializeComponent(registeredComponents[component])
      }
      return null
    } else if (typeof component === 'function') {
      const componentName = getComponentName(component)

      // if it has a name, use that indirection to find in the instance's map
      if (componentName != null) {
        if (this.componentInstances.has(componentName)) {
          return this.componentInstances.get(componentName)
        }

        // If we don't have a local instance, create the instance of the component
        return this.initializeComponent(component)
      }
    }

    throw Object.assign(
      new Error('Cannot get instance of the specified component'),
      { component }
    )
  }

  /**
   * This method unmounts all the components and releases the Worker
   */
  unmount() {
    this.notify('SIGKILL')

    this.emit(ComponentSystemEvents.systemWillUnmount)

    this.componentInstances.forEach(PrivateHelpers.unmountComponent)
    this.componentInstances.clear()

    this.worker.terminate()

    this.emit(ComponentSystemEvents.systemDidUnmount)
  }

  protected initializeComponent<X extends Component>(ctor: {
    new (options: ComponentOptions): X
    factory?(
      ctor: { new (options: ComponentOptions): X },
      options: ComponentOptions
    ): X
  }): X {
    const componentName = getComponentName(ctor)

    if (componentName === null) {
      throw new Error('The plugin is not registered')
    }

    if (this.componentInstances.has(componentName)) {
      return this.componentInstances.get(componentName) as X
    }

    const componentOptions: ComponentOptions = {
      componentName,
      on: (event, handler) => this.on(`${componentName}.${event}`, handler),
      notify: (event, params) =>
        this.notify(`${componentName}.${event}`, params),
      expose: (event, handler) =>
        this.expose(`${componentName}.${event}`, handler)
    }

    const instance = ctor.factory
      ? ctor.factory(ctor, componentOptions)
      : new ctor(componentOptions)

    this.componentInstances.set(componentName, instance)

    return instance
  }

  /**
   * Preloads a list of components
   */
  private async RPCLoadComponents(componentNames: string[]) {
    if (
      typeof componentNames !== 'object' ||
      !(componentNames instanceof Array)
    ) {
      throw new TypeError(
        'RPCLoadComponents(names) name must be an array of strings'
      )
    }

    const notFound = componentNames
      .map(name => ({ component: this.getComponentInstance(name), name }))
      .filter($ => $.component == null)
      .map($ => $.name)

    if (notFound.length) {
      throw new TypeError(`Components not found ${notFound.join(',')}`)
    }
  }
}
