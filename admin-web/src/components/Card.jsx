// A real raised card with a colored header strip + small icon — the "distinct visual
// weight per section" treatment: box-shadow, rounded corners, a colored top border
// that varies by accent (navy/teal/violet/amber/rose) so sections read as visually
// distinct rather than one undifferentiated white box after another.
export default function Card({ title, icon: Icon, accent = 'navy', children, actions }) {
  return (
    <div className={`panel panel-${accent}`}>
      {(title || Icon) && (
        <div className="panel-header">
          {Icon && <span className="panel-icon"><Icon size={14} /></span>}
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  );
}
