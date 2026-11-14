import { TaskList, TaskItem } from '@tiptap/extension-list';
import BridgeExtension from './base';
import { createRadioListExtensions } from './radioListNodes';

/**
 * InfiniKan fork: radio buttons (single-choice lists), the twin of TaskListBridge.
 * Picking an item clears the others in its list (radioListNodes.pickRadioItem).
 */
const { RadioList, RadioItem } = createRadioListExtensions({
  TaskList,
  TaskItem,
});

type RadioListEditorState = {
  isRadioListActive: boolean;
  canToggleRadioList: boolean;
};

type RadioListEditorInstance = {
  toggleRadioList: () => void;
};

declare module '../types/EditorBridge' {
  interface BridgeState extends RadioListEditorState {}
  interface EditorBridge extends RadioListEditorInstance {}
}

export enum RadioListEditorActionType {
  ToggleRadioList = 'toggle-radio-list',
}

type RadioListMessage = {
  type: RadioListEditorActionType.ToggleRadioList;
  payload?: undefined;
};

export const RadioListBridge = new BridgeExtension<
  RadioListEditorState,
  RadioListEditorInstance,
  RadioListMessage
>({
  tiptapExtension: RadioList,
  tiptapExtensionDeps: [RadioItem.configure({ nested: true })],
  onBridgeMessage: (editor, message) => {
    if (message.type === RadioListEditorActionType.ToggleRadioList) {
      (editor.chain().focus() as any).toggleRadioList().run();
    }
    return false;
  },
  extendEditorInstance: (sendBridgeMessage) => {
    return {
      toggleRadioList: () =>
        sendBridgeMessage({ type: RadioListEditorActionType.ToggleRadioList }),
    };
  },
  extendEditorState: (editor) => {
    return {
      canToggleRadioList: !!(editor.can() as any).toggleRadioList?.(),
      isRadioListActive: editor.isActive('radioList'),
    };
  },
  extendCSS: `
  ul[data-type="radioList"] {
    list-style: none;
    padding: 0;
  }
  ul[data-type="radioList"] > li {
    display: flex;
  }
  ul[data-type="radioList"] p {
    margin: 0;
  }
  ul[data-type="radioList"] li > label > input {
    margin: 0.1rem;
    accent-color: black;
  }
  ul[data-type="radioList"] li > label {
    flex: 0 0 auto;
    margin-right: 0.5rem;
    user-select: none;
  }
  ul[data-type="radioList"] li > div {
    flex: 1 1 auto;
  }
  `,
});
