export default function AppLayout({ toolbar, tree, sidebar, banner }) {
  return (
    <div className="app-layout">
      {banner}
      {toolbar}
      <div className="app-body">
        <div className="app-main">{tree}</div>
        <aside className="app-sidebar">{sidebar}</aside>
      </div>
    </div>
  );
}
