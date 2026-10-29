import { useTree } from '../../hooks/useTree.js';
import TreeNode from './TreeNode.jsx';

/**
 * Renders the root of the SDK snapshot. This is the only component that
 * needs the whole tree; children subscribe individually.
 */
export default function FileTree() {
  const tree = useTree();

  return (
    <section className="panel tree-panel" aria-label="File tree">
      <h2 className="panel-title">Files</h2>
      <ul role="tree" className="tree" data-testid="file-tree">
        <TreeNode node={tree} depth={0} />
      </ul>
    </section>
  );
}
