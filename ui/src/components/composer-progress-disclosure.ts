import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import { ref } from "lit/directives/ref.js";

export type ComposerProgressRunLifecycle = {
  activeRunId?: string | null;
  completedRunId?: string | null;
  readingHistory?: boolean;
  onManipulate?: () => void;
};

// One presentation owner for automatic disclosure, accessible activation, and
// direct manipulation. Partial choices are pixel extents, never time or a
// fraction of a changing transcript/content range.
class ComposerDisclosureDirective extends AsyncDirective {
  private element?: HTMLDetailsElement;
  private summary?: HTMLElement;
  private body?: HTMLElement;
  private sessionKey?: string;
  private activeRunId: string | null = null;
  private handledCompletedRunId: string | null = null;
  private automaticOpen = false;
  private readingHistory = false;
  private manual: boolean | number | undefined;
  private lifecycle?: ComposerProgressRunLifecycle;
  private listeners?: AbortController;
  private resizeObserver?: ResizeObserver;
  private drag?: { id: number; x: number; y: number; extent: number; active: boolean };
  private suppressClick = false;

  override render(
    sessionKey: string,
    initialOpen: boolean,
    collapseByDefault: boolean,
    lifecycle?: ComposerProgressRunLifecycle,
  ) {
    this.lifecycle = lifecycle;
    const activeRunId = lifecycle?.activeRunId ?? null;
    const completedRunId = lifecycle?.completedRunId ?? null;
    if (sessionKey !== this.sessionKey) {
      this.cancelDrag();
      this.sessionKey = sessionKey;
      this.activeRunId = activeRunId;
      this.handledCompletedRunId = completedRunId;
      this.manual = undefined;
      this.automaticOpen = initialOpen;
    } else if (activeRunId && activeRunId !== this.activeRunId) {
      this.cancelDrag();
      this.activeRunId = activeRunId;
      this.handledCompletedRunId = null;
      this.manual = undefined;
      this.automaticOpen = !collapseByDefault;
    }
    if (
      completedRunId &&
      completedRunId === this.activeRunId &&
      completedRunId !== this.handledCompletedRunId
    ) {
      this.handledCompletedRunId = completedRunId;
      this.automaticOpen = true;
    }
    this.readingHistory = lifecycle?.readingHistory ?? false;
    this.apply();
    return ref(this.attach);
  }

  private readonly attach = (element?: Element) => {
    if (element === this.element) {
      return;
    }
    this.disconnect();
    this.element = element instanceof HTMLDetailsElement ? element : undefined;
    this.summary = this.element?.querySelector<HTMLElement>("summary") ?? undefined;
    this.body =
      this.element?.querySelector<HTMLElement>(".session-progress-card__body") ?? undefined;
    if (!this.element || !this.summary || !this.body) {
      return;
    }
    this.connect();
    this.apply();
  };

  protected override disconnected(): void {
    this.disconnect();
  }
  protected override reconnected(): void {
    this.connect();
    this.apply();
  }

  private connect(): void {
    if (!this.summary || this.listeners) {
      return;
    }
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    this.summary.addEventListener("click", this.click, { signal });
    this.summary.addEventListener("wheel", this.wheel, { passive: false, signal });
    this.summary.addEventListener("pointerdown", this.pointerDown, { signal });
    this.summary.addEventListener("pointermove", this.pointerMove, { signal });
    this.summary.addEventListener("pointerup", this.pointerEnd, { signal });
    this.summary.addEventListener("pointercancel", this.pointerEnd, { signal });
    this.summary.addEventListener("lostpointercapture", this.pointerEnd, { signal });
    this.summary.ownerDocument.addEventListener("pointerdown", this.otherPointer, {
      capture: true,
      signal,
    });
    this.summary.ownerDocument.defaultView?.addEventListener("blur", this.cancelDrag, { signal });
    // Only viewport changes can clamp a retained manual extent. Streamed card
    // revisions cannot resize it, even when the revised note is shorter.
    this.summary.ownerDocument.defaultView?.addEventListener("resize", this.clampExtent, {
      signal,
    });
    if (typeof ResizeObserver !== "undefined" && this.body) {
      this.resizeObserver = new ResizeObserver(this.clampExtent);
      this.resizeObserver.observe(this.body);
    }
  }

  private disconnect(): void {
    this.cancelDrag();
    this.listeners?.abort();
    this.listeners = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
  }

  private chosen(): boolean | number {
    return this.manual ?? (this.automaticOpen && !this.readingHistory);
  }

  private limit(): number {
    return this.body ? Number.parseFloat(getComputedStyle(this.body).maxHeight) || 300 : 300;
  }

  private extent(): number {
    const chosen = this.chosen();
    return typeof chosen === "number"
      ? Math.min(chosen, this.limit())
      : chosen
        ? (this.body?.getBoundingClientRect().height ?? 0)
        : 0;
  }

  private apply(): void {
    if (!this.element || !this.body) {
      return;
    }
    const chosen = this.chosen();
    const partial = typeof chosen === "number";
    const extent = partial ? Math.min(chosen, this.limit()) : 0;
    this.element.open = partial ? extent > 0 : chosen;
    this.body.style.height = partial ? extent + "px" : "";
    this.body.style.minHeight = partial ? extent + "px" : "";
    this.element.dataset.reveal = partial ? "partial" : chosen ? "open" : "closed";
  }

  private readonly clampExtent = () => {
    if (typeof this.manual === "number" && this.manual > this.limit()) {
      this.manual = this.limit();
      this.cancelDrag();
    }
    this.apply();
  };

  private isControl(event: Event): boolean {
    return (
      event.target instanceof Element &&
      Boolean(event.target.closest("button, a, input, select, textarea"))
    );
  }

  private readonly click = (event: MouseEvent) => {
    if (event.defaultPrevented || this.isControl(event)) {
      return;
    }
    event.preventDefault();
    if (this.suppressClick && event.detail !== 0) {
      this.suppressClick = false;
      return;
    }
    this.cancelDrag();
    // Partial sheets expand first, but a gesture can already reveal the full
    // viewport (or all short content) without choosing the boolean open state.
    const chosen = this.chosen();
    const fullyRevealed =
      chosen === true ||
      (typeof chosen === "number" &&
        chosen > 0 &&
        (chosen >= this.limit() ||
          Boolean(
            this.body &&
            this.body.clientHeight > 0 &&
            this.body.scrollHeight <= this.body.clientHeight + 1,
          )));
    this.manual = !fullyRevealed;
    this.apply();
  };

  private move(extent: number): void {
    this.manual = Math.max(0, Math.min(this.limit(), extent));
    this.lifecycle?.onManipulate?.();
    this.apply();
  }

  private readonly wheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      this.isControl(event) ||
      this.drag ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !Number.isFinite(event.deltaY) ||
      !Number.isFinite(event.deltaX) ||
      !event.deltaY ||
      Math.abs(event.deltaX) >= Math.abs(event.deltaY)
    ) {
      return;
    }
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? Number.parseFloat(getComputedStyle(this.summary!).lineHeight) || 18
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? this.limit()
          : 1;
    const extent = this.extent();
    const next = Math.max(0, Math.min(this.limit(), extent - event.deltaY * unit));
    // The header is the only wheel target. Body and transcript scrolling stay native.
    event.preventDefault();
    if (next !== extent) {
      this.move(next);
    }
  };

  private readonly pointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || this.isControl(event) || event.defaultPrevented) {
      return;
    }
    this.suppressClick = false;
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      extent: this.extent(),
      active: false,
    };
    this.summary?.setPointerCapture(event.pointerId);
  };

  private readonly pointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 3) {
        return;
      }
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.cancelDrag();
        return;
      }
      drag.active = true;
      this.suppressClick = true;
    }
    event.preventDefault();
    const requested = drag.extent - dy;
    this.move(requested);
    // Discard excess travel at a hard boundary so reversal responds immediately.
    if (requested < 0 || requested > this.limit()) {
      drag.extent = this.extent();
      drag.y = event.clientY;
    }
  };

  private readonly otherPointer = (event: PointerEvent) => {
    if (this.drag && event.pointerId !== this.drag.id) {
      this.cancelDrag();
    }
  };

  private readonly pointerEnd = (event: PointerEvent) => {
    if (event.pointerId === this.drag?.id) {
      this.cancelDrag();
    }
  };

  private readonly cancelDrag = () => {
    const drag = this.drag;
    this.drag = undefined;
    if (drag && this.summary?.hasPointerCapture(drag.id)) {
      this.summary.releasePointerCapture(drag.id);
    }
  };
}

export const composerDisclosure = directive(ComposerDisclosureDirective);
