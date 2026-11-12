// ICP 备案号：公网访问 nianlife.cn 必须在页面底部展示，并链接到工信部备案查询。
// 号码来自 Teddy 提供的备案通过截图；公安备案号尚未取得，不写。
export const ICP_RECORD = "浙ICP备2026024416号-2";
export const ICP_LINK = "https://beian.miit.gov.cn/";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span className="site-footer-brand">张年的人生档案 · Life is about a dream</span>
        <a href={ICP_LINK} target="_blank" rel="noopener noreferrer">{ICP_RECORD}</a>
      </div>
    </footer>
  );
}
