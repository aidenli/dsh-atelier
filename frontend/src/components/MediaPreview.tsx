/** 共用媒体预览：预览与使用按钮独立；音频保留封面占位与原生试听入口。 */
import { Alert, Modal } from "antd";
import { Maximize2, Music2, File } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "./common";

/** controls 用于任务详情内嵌播放；关闭浮层即卸载播放器，避免后台继续出声。 */
export function MediaPreview({
  src,
  kind,
  title,
  controls = false,
}: {
  src: string;
  kind: string;
  title: string;
  controls?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    inline = useRef<HTMLVideoElement>(null),
    expanded = useRef<HTMLVideoElement>(null);
  const position = useRef(0);
  const audio = useRef<HTMLAudioElement>(null);
  function enlarge() {
    // 详情内联播放器先暂停，浮层从相同位置开始，禁止两个播放器同时出声。
    position.current = inline.current?.currentTime || 0;
    inline.current?.pause();
    setError(false);
    setOpen(true);
  }
  const media =
    kind === "image" ? (
      <img src={src} alt={title} loading="lazy" />
    ) : kind === "audio" ? (
      <span className="atelier-audio-cover">
        <Music2 size={48} />
      </span>
    ) : kind !== "video" ? (
      <span className="atelier-audio-cover">
        <File size={48} />
      </span>
    ) : (
      <video
        ref={inline}
        src={src}
        preload="metadata"
        controls={controls}
        muted={!controls}
        playsInline
      />
    );
  return (
    <div ref={root} className="atelier-media">
      {controls ? (
        <>
          {media}
          <span className="atelier-media-enlarge">
            <IconButton
              label={`放大预览 ${title}`}
              icon={<Maximize2 size={17} />}
              onClick={enlarge}
            />
          </span>
        </>
      ) : (
        <button
          type="button"
          className="atelier-media-open"
          aria-label={`放大预览 ${title}`}
          onClick={enlarge}
        >
          {media}
          <span className="atelier-media-hint">
            <Maximize2 size={18} />
          </span>
        </button>
      )}
      <Modal
        open={open}
        destroyOnHidden
        title={title}
        footer={null}
        centered
        width="calc(100% - 32px)"
        rootClassName="atelier-local-modal atelier-media-modal"
        getContainer={() =>
          root.current!.closest<HTMLElement>(".atelier-workspace")!
        }
        onCancel={() => {
          expanded.current?.pause();
          audio.current?.pause();
          setOpen(false);
        }}
      >
        {error && (
          <Alert type="error" showIcon title="媒体加载失败，请关闭预览后重试" />
        )}
        {open &&
          (kind === "image" ? (
            <img
              className="atelier-media-expanded"
              src={src}
              alt={title}
              onError={() => setError(true)}
            />
          ) : kind === "audio" ? (
            <audio
              ref={audio}
              className="atelier-audio-expanded"
              src={src}
              controls
              preload="metadata"
              onError={() => setError(true)}
            />
          ) : kind !== "video" ? (
            <Alert type="info" title="暂不支持此文件类型的预览" />
          ) : (
            <video
              ref={expanded}
              className="atelier-media-expanded"
              src={src}
              controls
              playsInline
              preload="metadata"
              onError={() => setError(true)}
              onLoadedMetadata={(event) => {
                if (position.current > 0)
                  event.currentTarget.currentTime = position.current;
              }}
            />
          ))}
      </Modal>
    </div>
  );
}
