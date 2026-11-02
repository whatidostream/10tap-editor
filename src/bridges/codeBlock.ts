import CodeBlock from '@tiptap/extension-code-block';
import BridgeExtension from './base';

type CodeBlockEditorState = {
  isCodeBlockActive: boolean;
  canToggleCodeBlock: boolean;
};

type CodeBlockEditorInstance = {
  toggleCodeBlock: () => void;
};

declare module '../types/EditorBridge' {
  interface BridgeState extends CodeBlockEditorState {}
  interface EditorBridge extends CodeBlockEditorInstance {}
}

export enum CodeBlockEditorActionType {
  ToggleCodeBlock = 'toggle-code-block',
}

type CodeBlockMessage = {
  type: CodeBlockEditorActionType.ToggleCodeBlock;
  payload?: undefined;
};

export const CodeBlockBridge = new BridgeExtension<
  CodeBlockEditorState,
  CodeBlockEditorInstance,
  CodeBlockMessage
>({
  tiptapExtension: CodeBlock,
  onBridgeMessage: (editor, message) => {
    if (message.type === CodeBlockEditorActionType.ToggleCodeBlock) {
      editor.chain().focus().toggleCodeBlock().run();
    }

    return false;
  },
  extendEditorInstance: (sendBridgeMessage) => {
    return {
      toggleCodeBlock: () =>
        sendBridgeMessage({ type: CodeBlockEditorActionType.ToggleCodeBlock }),
    };
  },
  extendEditorState: (editor) => {
    return {
      canToggleCodeBlock: editor.can().toggleCodeBlock(),
      isCodeBlockActive: editor.isActive('codeBlock'),
    };
  },
  extendCSS: `
    pre {
      background-color: #f4f4f4;
      border-radius: 0.5em;
      padding: 0.75rem 1rem;
      font-family: 'JetBrainsMono', monospace;
    }

    pre code {
      color: inherit;
      padding: 0;
      background: none;
      font-size: 0.8rem;
    }
  `,
});
