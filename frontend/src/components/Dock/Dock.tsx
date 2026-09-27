import { motion } from 'motion/react';
import React from 'react';
import './Dock.css';

/**
 * Minimal Dock component that only provides the hover‑magnification animation.
 * It accepts an array of items where each item must contain an `icon` (ReactNode)
 * and a `label` (string). The animation enlarges the hovered item to the
 * `magnification` size while keeping the others at `baseItemSize`.
 */
interface DockItemProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}

interface DockProps {
  items: DockItemProps[];
  /** Height of the dock panel */
  panelHeight?: number;
  /** Base (default) size of each item */
  baseItemSize?: number;
  /** Size of the item when hovered */
  magnification?: number;
}

export default function Dock({
  items,
  panelHeight = 68,
  baseItemSize = 50,
  magnification = 70,
}: DockProps) {
  return (
    <div className="dock-outer" style={{ height: panelHeight }}>
      <div className="dock-panel" role="toolbar" aria-label="Application dock">
        {items.map((item, idx) => (
          <motion.div
            key={idx}
            className="dock-item"
            onClick={item.onClick}
            whileHover={{ width: magnification, height: magnification }}
            style={{ width: baseItemSize, height: baseItemSize }}
            tabIndex={0}
            role="button"
            aria-label={item.label}
          >
            <div className="dock-icon">{item.icon}</div>
            <motion.div
              className="dock-label"
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: 1, y: -10 }}
              exit={{ opacity: 0, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              {item.label}
            </motion.div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
