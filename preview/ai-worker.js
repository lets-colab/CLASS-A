let generator;
let loading;
self.addEventListener('message', async event => {
  try {
    if (event.data.type === 'load') {
      if (!generator) {
        if (!loading) loading = (async () => {
          const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm');
          env.allowLocalModels = false;
          env.backends.onnx.wasm.numThreads = 1;
          return pipeline('question-answering', 'Xenova/distilbert-base-cased-distilled-squad', {
            dtype: 'q8', device: 'wasm',
            progress_callback: progress => {
              const percent = progress.progress !== undefined ? ` ${Math.round(progress.progress)}%` : '';
              const file = progress.file ? ` · ${progress.file.split('/').pop()}` : '';
              self.postMessage({ type: 'progress', message: `Loading local model${percent}${file}` });
            }
          });
        })();
        generator = await loading;
      }
      self.postMessage({ type: 'ready' });
    }
    if (event.data.type === 'generate') {
      if (!generator) throw new Error('Local model has not loaded.');
      let best = { score: 0, id: '', excerpt: '' };
      for (const item of event.data.candidates) {
        const result = await generator(event.data.question, item.answer, { top_k: 1 });
        const selected = Array.isArray(result) ? result[0] : result;
        if (typeof selected?.answer === 'string' && item.answer.includes(selected.answer) && selected.score > best.score) best = { score: selected.score, id: item.id, excerpt: selected.answer };
      }
      self.postMessage({ type: 'answer', ...best });
    }
  } catch (error) { if (!generator) loading = null; self.postMessage({ type: 'error', message: error.message || 'Local AI could not run.' }); }
});
