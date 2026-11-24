import React from 'react';
import { EditorContent } from '@tiptap/react';
import { useTenTap } from '../webEditorUtils';
import { TenTapStartKit } from '../bridges/StarterKit';
import { SectionBridge } from '../bridges/section';

let tenTapExtensions = [...TenTapStartKit, SectionBridge].filter(
  (e) =>
    !window.whiteListBridgeExtensions ||
    window.whiteListBridgeExtensions.includes(e.name)
);

export default function Tiptap() {
  const editor = useTenTap({ bridges: tenTapExtensions });

  return (
    <EditorContent
      editor={editor}
      className={window.dynamicHeight ? 'dynamic-height' : undefined}
    />
  );
}
