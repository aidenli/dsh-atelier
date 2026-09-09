/** 素材选择只写草稿；删除与上传均使用后端 API，局部弹窗不遮盖聊天。 */
import { Alert, Button, Empty, Modal, Segmented, Upload } from "antd";
import {
  Plus,
  Image as ImageIcon,
  Video,
  Music2,
  File,
  Trash2,
  Upload as UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { Bridge } from "../../../contracts/types";
import type { useWorkspaceData } from "../hooks/useWorkspaceData";
import { IconButton, message } from "../components/common";
import { MediaPreview } from "../components/MediaPreview";
import { CreatedAt } from "../components/CreatedAt";
export function AssetsPage({
  model,
  bridge,
  sessionId,
  container,
}: {
  model: ReturnType<typeof useWorkspaceData>;
  bridge: Bridge;
  sessionId: string;
  container: () => HTMLElement;
}) {
  const [deleting, setDeleting] = useState<string[]>([]),
    [filter, setFilter] = useState("all"),
    [error, setError] = useState(""),
    [deletingNow, setDeletingNow] = useState(false);
  const locked = useRef(false),
    cancel = useRef<HTMLButtonElement>(null),
    origin = useRef<HTMLElement | null>(null),
    toolbar = useRef<HTMLDivElement>(null);
  const canDelete =
    model.health.capabilities?.includes("asset-delete") === true;
  function confirm(ids: string[]) {
    origin.current = document.activeElement as HTMLElement;
    setError("");
    setDeleting(ids);
  }
  async function remove() {
    if (locked.current) return;
    locked.current = true;
    setDeletingNow(true);
    try {
      await bridge.post("/deleteAssets", { ids: deleting });
      setDeleting([]);
      await model.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      locked.current = false;
      setDeletingNow(false);
    }
  }
  const list = model.assets.filter(
    (a) => filter === "all" || a.kind === filter,
  );
  return (
    <>
      <div className="atelier-section-head">
        <div>
          <h2>素材库</h2>
          <p>{model.assets.length} 个素材</p>
        </div>
        <Upload
          multiple
          showUploadList={false}
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
          customRequest={({ file, onSuccess, onError }) => {
            void bridge.upload(sessionId, file as File).then(
              (a) => {
                onSuccess?.(a);
                void model.refresh();
              },
              (e) => {
                onError?.(e);
                model.setError(message(e));
              },
            );
          }}
        >
          <Button icon={<UploadIcon size={16} />}>上传</Button>
        </Upload>
      </div>
      {!canDelete && (
        <Alert
          type="warning"
          showIcon
          title="当前后端不支持素材删除，请重启新版后端"
        />
      )}
      <div className="atelier-asset-toolbar" ref={toolbar} tabIndex={-1}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "全部" },
            { value: "image", label: "图片" },
            { value: "video", label: "视频" },
            { value: "audio", label: "音频" },
          ]}
        />
      </div>
      <div className="atelier-asset-grid">
        {list.map((asset) => (
          <article className="atelier-asset-item" key={asset.id}>
            <div className="atelier-asset-preview">
              <MediaPreview
                src={bridge.fileUrl(asset.id)}
                kind={asset.kind}
                title={asset.name}
              />
              <span className={`atelier-asset-kind atelier-kind-${asset.kind}`}>
                {asset.kind === "image" ? (
                  <>
                    <ImageIcon size={13} />
                    图片
                  </>
                ) : asset.kind === "video" ? (
                  <>
                    <Video size={13} />
                    视频
                  </>
                ) : asset.kind === "audio" ? (
                  <>
                    <Music2 size={13} />
                    音频
                  </>
                ) : (
                  <>
                    <File size={13} />
                    文件
                  </>
                )}
              </span>
            </div>
            <div className="atelier-asset-caption">
              <strong title={asset.name}>{asset.name}</strong>
              <IconButton
                label={`删除 ${asset.name}`}
                icon={<Trash2 size={15} />}
                disabled={!canDelete || model.busy}
                onClick={() => confirm([asset.id])}
              />
            </div>
            <CreatedAt value={asset.createdAt} />
            <div className="atelier-asset-footer">
              <small>{(asset.size / 1048576).toFixed(1)} MB</small>
              <Button
                icon={<Plus size={15} />}
                disabled={model.busy}
                onClick={() =>
                  void model.act(() => bridge.select(sessionId, [asset]))
                }
              >
                使用
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!list.length && <Empty description="暂无素材" />}
      <Modal
        destroyOnHidden
        open={!!deleting.length}
        title={`删除 ${deleting.length} 个素材？`}
        getContainer={container}
        rootClassName="atelier-local-modal"
        centered
        width={400}
        closable={!deletingNow}
        maskClosable={false}
        keyboard={!deletingNow}
        onCancel={() => setDeleting([])}
        afterOpenChange={(open) => {
          if (open) cancel.current?.focus();
          else
            (origin.current?.isConnected
              ? origin.current
              : toolbar.current
            )?.focus();
        }}
        footer={
          <>
            <Button
              ref={cancel}
              disabled={deletingNow}
              onClick={() => setDeleting([])}
            >
              取消
            </Button>
            <Button
              danger
              type="primary"
              loading={deletingNow}
              onClick={() => void remove()}
            >
              删除
            </Button>
          </>
        }
      >
        <p>从素材库移除，历史任务引用的文件会保留。</p>
        {error && <Alert type="error" showIcon title={error} />}
      </Modal>
    </>
  );
}
