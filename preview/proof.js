const outline = document.querySelector('#class-outline');
try {
  const [mapResponse, reportResponse] = await Promise.all([fetch('/CLASS-A/preview/assets/proof/curriculum-outline.json'),fetch('/CLASS-A/preview/assets/proof/test-report.json')]);
  if (mapResponse.ok) {
    const map = await mapResponse.json();
    for (const lesson of map.classes) { const li = document.createElement('li'); li.textContent = lesson.title; outline.append(li); }
  } else throw new Error('Outline unavailable');
  if (reportResponse.ok) {
    const report = await reportResponse.json();
    document.querySelector('#test-count').textContent = report.exit_code === 0 ? `${report.tests_passed} scoped checks passed.` : 'Checks need review.';
    document.querySelector('#test-caption').textContent = `Recorded ${report.display_date}. Inspect the exact output and included source, or run the checks yourself.`;
  }
} catch {
  const li = document.createElement('li'); li.textContent = 'Use the downloadable outline to inspect the curriculum.'; outline.append(li);
}
