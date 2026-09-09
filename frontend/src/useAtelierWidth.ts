/** 保留聊天最小可用宽度，其余尽量分配给项目页；退出恢复原生列宽。 */
import { useEffect, type RefObject } from "react";

export function useAtelierWidth(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let frame = ref.current?.parentElement;
    while (frame && !frame.style.gridTemplateColumns)
      frame = frame.parentElement;
    if (!frame) return;
    const target = frame;
    const minChatWidth = 520;
    let preferredChat = minChatWidth;
    let drag: { x: number; chat: number } | undefined;
    const handle = ref.current?.querySelector<HTMLElement>(".atelier-resize");
    // DSH 当前内联格式为 sidebar px / minmax / details px；只读取，不重写其拖拽偏好。
    const update = () => {
      const tracks = target.style.gridTemplateColumns;
      const sidebar = Number.parseFloat(tracks) || 56;
      const available = Math.max(0, target.clientWidth - sidebar);
      // 独立手柄只调整临时聊天宽度，不写入 DSH 原生偏好；默认不受原生详情上限约束。
      const chat = Math.min(Math.max(minChatWidth, preferredChat), available);
      const width = Math.max(0, available - chat);
      for (const [key, value] of [
        ["--atelier-sidebar-width", `${sidebar}px`],
        ["--atelier-panel-width", `${width}px`],
      ]) {
        if (target.style.getPropertyValue(key) !== value)
          target.style.setProperty(key, value);
      }
    };
    target.dataset.atelierLayout = "true";
    update();
    const startDrag = (e: PointerEvent) => {
      e.preventDefault();
      handle?.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, chat: preferredChat };
    };
    const move = (e: PointerEvent) => {
      if (drag) {
        preferredChat = Math.max(minChatWidth, drag.chat + e.clientX - drag.x);
        update();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) {
        e.preventDefault();
        preferredChat =
          e.key === "Home"
            ? minChatWidth
            : Math.max(
                minChatWidth,
                preferredChat + (e.key === "ArrowRight" ? 24 : -24),
              );
        update();
      }
    };
    const endDrag = () => {
      drag = undefined;
    };
    handle?.addEventListener("pointerdown", startDrag);
    handle?.addEventListener("pointermove", move);
    handle?.addEventListener("keydown", key);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    const observer = new MutationObserver(update);
    const resize = new ResizeObserver(update);
    resize.observe(target);
    observer.observe(target, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", update);
      handle?.removeEventListener("pointerdown", startDrag);
      handle?.removeEventListener("pointermove", move);
      handle?.removeEventListener("keydown", key);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      delete target.dataset.atelierLayout;
      target.style.removeProperty("--atelier-sidebar-width");
      target.style.removeProperty("--atelier-panel-width");
    };
  }, [ref]);
}
