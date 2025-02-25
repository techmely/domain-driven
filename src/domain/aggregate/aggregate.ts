import { invariant } from "@techmely/es-toolkit";
import Emittery from "emittery";
import { Result } from "../../utils";
import { createEventContext } from "../context";
import type { ContextEventName, EventContextManager } from "../context/types";
import { Entity } from "../entity";
import { UniqueEntityID } from "../entity";
import type { EntityProps } from "../entity/types";
import { DomainEvents } from "../events";
import type {
  AggregateEventHandler,
  DomainEventHandler,
  DomainEventOptions,
} from "../events/types";
import type {
  AggregateClearEventsConfig,
  AggregateConfig,
  AggregatePort,
  DomainEventMetrics,
} from "./types";

export class Aggregate<T>
  extends Entity<EntityProps<T>>
  implements AggregatePort<EntityProps<T>>
{
  readonly #domainEvents: DomainEvents<this>;
  #dispatchEventsCount: number;
  readonly #aggregateConfig: AggregateConfig;
  readonly #props: EntityProps<T>;

  constructor(
    props: EntityProps<T>,
    config?: AggregateConfig,
    events?: DomainEvents<Aggregate<T>>
  ) {
    super(props, config);
    this.#props = props;
    this.#dispatchEventsCount = 0;
    this.#aggregateConfig = config ?? { emitter: new Emittery(), debug: false };
    this.#domainEvents = new DomainEvents(this);
    if (events) this.#domainEvents = events as unknown as DomainEvents<this>;
  }

  /**
   *
   * @param props params as Props
   * @param id optional uuid as string, second arg. If not provided a new one will be generated.
   * @returns instance of result with a new Aggregate on state if success.
   * @summary result state will be `null` case failure.
   */
  static override create<T>(
    props: Partial<EntityProps<T>>,
    config?: AggregateConfig
  ): Result<Aggregate<T>, any, any> {
    return Result.Ok(new Aggregate(props, config));
  }

  /**
   * @description Get aggregate metrics
   * @access current events as number representing total of events in state for aggregate
   * @access total as number representing total events for aggregate including dispatched
   * @access dispatch total of events already dispatched
   */
  get eventMetrics(): DomainEventMetrics {
    return {
      current: this.#domainEvents.metrics.totalEvents(),
      total:
        this.#domainEvents.metrics.totalEvents() + this.#dispatchEventsCount,
      dispatch: this.#dispatchEventsCount,
    };
  }

  /**
   * @description Get hash to identify the aggregate.
   */
  override hashCode(): UniqueEntityID {
    const instance = Reflect.getPrototypeOf(this);
    return new UniqueEntityID(
      `[Aggregate@${instance?.constructor.name}]:${this.#props.id}`
    );
  }

  override clone(
    props?: Partial<EntityProps<T>> & { copyEvents?: boolean }
  ): this {
    const _props = props ? { ...this.#props, ...props } : this.#props;
    const events = props && !!props.copyEvents ? this.#domainEvents : null;
    const instance = Reflect.getPrototypeOf(this);
    invariant(instance, "Cannot get prototype of this entity instance");
    const aggregate = Reflect.construct(instance.constructor, [
      _props,
      this.#aggregateConfig,
      events,
    ]);
    return aggregate;
  }

  context(): EventContextManager {
    return createEventContext(this.#aggregateConfig.emitter);
  }

  dispatchEvent(name: ContextEventName, ...args: unknown[]): void {
    this.#domainEvents.dispatch(name, args);
    this.#dispatchEventsCount++;
  }

  async dispatchAll(): Promise<void> {
    const totalEvents = this.#domainEvents.metrics.totalEvents();
    await this.#domainEvents.dispatchEvents();
    this.#dispatchEventsCount += totalEvents;
  }

  clearEvents(
    config: AggregateClearEventsConfig = { resetMetrics: false }
  ): void {
    if (config.resetMetrics) this.#dispatchEventsCount = 0;
    this.#domainEvents.clear();
  }

  addEvent(event: DomainEventHandler<this>): void;
  addEvent(
    name: string,
    handler: DomainEventHandler<this>,
    options?: DomainEventOptions | undefined
  ): void;
  addEvent(
    nameOrEvent: string | AggregateEventHandler<this>,
    handler: DomainEventHandler<this>,
    options?: DomainEventOptions | undefined
  ): void;
  addEvent(
    nameOrEvent: unknown,
    handler?: DomainEventHandler<this>,
    options?: DomainEventOptions
  ): void {
    if (typeof nameOrEvent === "string" && handler) {
      this.#domainEvents.add(nameOrEvent as ContextEventName, handler, options);
    }
    const _options = (nameOrEvent as AggregateEventHandler<this>)?.params
      ?.options;
    const eventName = (nameOrEvent as AggregateEventHandler<this>)?.params
      ?.name;
    const eventHandler = (nameOrEvent as AggregateEventHandler<this>)?.dispatch;
    this.#domainEvents.add(eventName, eventHandler, _options);
  }
  removeEvent(name: ContextEventName): number {
    const totalEvents = this.#domainEvents.metrics.totalEvents();
    this.#domainEvents.remove(name);
    return totalEvents - this.#domainEvents.metrics.totalEvents();
  }
}
