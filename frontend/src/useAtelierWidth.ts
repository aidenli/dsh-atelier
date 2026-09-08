/** 默认给聊天保留 700px，其余分配给工作台；退出即恢复原生列宽。 */
import { useEffect, type RefObject } from "react";

export function useAtelierWidth(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let frame = ref.current?.parentElement;
    while (frame && !frame.style.gridTemplateColumns)
      frame = frame.parentElement;
    if (!frame) return;
    const target = frame;
    let preferredChat = 700;
    let drag: { details: number; panel: number } | undefined;
    const handle = target.querySelector<HTMLElement>('[data-side="details"]');
    // DSH 当前内联格式为 sidebar px / minmax / details px；只读取，不重写其拖拽偏好。
    const update = () => {
      const tracks = target.style.gridTemplateColumns;
      const sidebar = Number.parseFloat(tracks) || 56;
      const details = Number.parseFloat(tracks.split(" ").at(-1) || "") || 360;
      const available = Math.max(0, target.clientWidth - sidebar);
      // 手动拖拽仍沿用平台事件，仅将原生轨道变化量应用到当前工作台宽度。
      // 默认布局不再受原生详情列 520px 上限或“两倍宽度”约束。
      if (drag)
        preferredChat = available - (drag.panel + details - drag.details);
      const chat = Math.min(Math.max(400, preferredChat), available);
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
    const startDrag = () => {
      drag = {
        details:
          Number.parseFloat(
            target.style.gridTemplateColumns.split(" ").at(-1) || "",
          ) || 360,
        panel: Number.parseFloat(
          target.style.getPropertyValue("--atelier-panel-width"),
        ),
      };
    };
    const endDrag = () => {
      drag = undefined;
    };
    handle?.addEventListener("pointerdown", startDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      handle?.removeEventListener("pointerdown", startDrag);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      delete target.dataset.atelierLayout;
      target.style.removeProperty("--atelier-sidebar-width");
      target.style.removeProperty("--atelier-panel-width");
    };
  }, [ref]);
}
