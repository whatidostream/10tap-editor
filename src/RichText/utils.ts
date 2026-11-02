import { Platform } from 'react-native';
import type BridgeExtension from '../bridges/base';
import type { EditorBridge } from '../types';
import { editorHtml } from '../simpleWebEditor/build/editorHtml';

/**
 * Creates HTML with background color pre-injected to prevent flash on load.
 * This injects the background color directly into the HTML template before the WebView loads it.
 * @param backgroundColor - The background color to inject (e.g., '#1C1C1E' or 'white')
 * @returns The modified HTML string with background color applied
 */
export const createThemedHtml = (backgroundColor: string): string => {
  // Inject a style tag right after <head> to set background color immediately
  // This ensures the background is set before any other content loads
  const bgStyle = `<style id="tentap-theme-preload">html,body{background-color:${backgroundColor}!important;}</style>`;

  // Insert after the opening <head> tag
  return editorHtml.replace(/<head[^>]*>/i, `$&${bgStyle}`);
};

/**
 * Creates a new style element and appends it to the head of the document.
 * If the style element already exists, it will update the content of the existing element.
 * @param css - array of css strings
 * @param styleSheetTag - a unique tag to identify the style element - if not provided, a new style element will be created
 * @returns a string of javascript that is ready to be injected into the rich text webview
 */
export const getStyleSheetCSS = (css: string, styleSheetTag: string) => {
  return `
    cssContent = \`${css}\`;
    head = document.head || document.getElementsByTagName('head')[0],
    styleElement = head.querySelector('style[data-tag="${styleSheetTag}"]');
  
    if (!styleElement) {
      // If no such element exists, create a new <style> element.
      styleElement = document.createElement('style');
      styleElement.setAttribute('data-tag', '${styleSheetTag}'); // Assign the unique 'data-tag' attribute.
      styleElement.type = 'text/css'; // Specify the type attribute for clarity.
      head.appendChild(styleElement); // Append the newly created <style> element to the <head>.
    }
    
    styleElement.innerHTML = cssContent;
    `;
};

export const getInjectedJS = (bridgeExtensions: BridgeExtension[]) => {
  let injectJS = '';
  // For each bridge extension, we create a stylesheet with it's name as the tag
  const styleSheets = bridgeExtensions.map(({ extendCSS, name }) =>
    getStyleSheetCSS(extendCSS || '', name)
  );
  injectJS += styleSheets.join(' ');
  injectJS += ' true;';
  return injectJS;
};

/**
 * Get js code to inject into webview before the content loads
 */
export const getInjectedJSBeforeContentLoad = (editor: EditorBridge) => {
  return formatForInjection(`
  ${
    editor.bridgeExtensions
      ? `
      window.bridgeExtensionConfigMap = '${JSON.stringify(
        editor.bridgeExtensions.reduce((acc, bridge) => {
          return {
            ...acc,
            [bridge.name]: {
              optionsConfig: bridge.config,
              extendConfig: bridge.extendConfig,
            },
          };
        }, {})
      )}';

      window.whiteListBridgeExtensions = [${editor.bridgeExtensions
        .map((bridgeExtension) => `'${bridgeExtension.name}'`)
        .join(',')}];
          `
      : ''
  }${
    editor.initialContent
      ? `window.initialContent = ${JSON.stringify(editor.initialContent)};`
      : ''
  }
    window.editable = ${editor.editable};
    window.disableColorHighlight = ${!!editor.disableColorHighlight};
    window.dynamicHeight = ${editor.dynamicHeight};
    window.contentInjected = true;
    window.platform = "${Platform.OS}";
    (function() {
      var bgColor = '${
        (editor.theme?.webview as any)?.backgroundColor || 'white'
      }';
      document.documentElement.style.backgroundColor = bgColor;
      if (document.body) { document.body.style.backgroundColor = bgColor; }
    })();
  `);
};

const formatForInjection = (js: string) => {
  return js.replace(/\n/g, '').trim();
};
