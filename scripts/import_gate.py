#!/usr/bin/env python3
"""Conservative, offline intake checks for original ChatGPT Sites source exports.

Passing does NOT certify source fidelity, visual equivalence, backend integration or deployment.
"""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {'script', 'img', 'source', 'video', 'audio', 'iframe'} and attrs.get('src'):
            self.urls.append(attrs['src'])
        if tag == 'link' and attrs.get('href'):
            self.urls.append(attrs['href'])
        if tag in {'video'} and attrs.get('poster'):
            self.urls.append(attrs['poster'])


def inspect(root: Path):
    root = root.resolve()
    site = root / 'site'
    if not site.is_dir() or not any(site.rglob('*')):
        return 2, {'state': 'SOURCE_MISSING', 'reason': 'Upload original source and assets to site/. Nothing was deployed.'}
    all_paths = sorted(site.rglob('*'))
    unsafe = []
    for p in all_paths:
        name = p.name.lower()
        if p.is_symlink() or (p.is_file() and (name == '.env' or name.startswith('.env.') or name.endswith(('.pem', '.p12', '.pfx', '.key')))):
            unsafe.append(str(p.relative_to(root)))
    if unsafe:
        return 3, {'state': 'UNSAFE_SOURCE', 'paths': unsafe, 'reason': 'Potential secrets or symlinks must be removed/reviewed before import.'}

    files = [p for p in all_paths if p.is_file()]
    index = site / 'index.html'
    pkg = site / 'package.json'
    if index.is_file():
        source_type = 'static'
    elif pkg.is_file():
        try:
            package = json.loads(pkg.read_text(encoding='utf-8'))
        except (ValueError, UnicodeError):
            return 2, {'state': 'SOURCE_INVALID', 'reason': 'Unparseable package.json'}
        source_type = 'node'
        candidate = any(p.suffix in {'.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'} for p in files if 'node_modules' not in p.parts)
        if not (candidate and isinstance(package.get('scripts', {}).get('build'), str)):
            return 2, {'state': 'SOURCE_INCOMPLETE', 'reason': 'Node import needs real app sources and a build script.'}
    else:
        return 2, {'state': 'SOURCE_INCOMPLETE', 'reason': 'No index.html or buildable package.json with source.'}

    missing = []
    if source_type == 'static':
        parser = AssetParser()
        parser.feed(index.read_text(encoding='utf-8', errors='replace'))
        for url in parser.urls:
            parts = urlsplit(url)
            if parts.scheme or parts.netloc or url.startswith(('#', '//', 'data:', 'blob:', 'mailto:', 'tel:')):
                continue
            relative = unquote(parts.path).lstrip('/')
            if not relative:
                continue
            target = (site / relative) if parts.path.startswith('/') else (index.parent / relative)
            try:
                target_resolved = target.resolve()
                target_resolved.relative_to(site.resolve())
            except ValueError:
                missing.append(url + ' (unsafe path)')
                continue
            if not target_resolved.is_file():
                missing.append(url)
    if missing:
        return 4, {'state': 'REFERENCES_MISSING', 'missing': sorted(missing), 'reason': 'Referenced local assets must be included in site/.'}

    digest = hashlib.sha256()
    for p in files:
        rel = p.relative_to(site).as_posix()
        digest.update(rel.encode('utf-8') + b'\0')
        digest.update(p.read_bytes())
    return 0, {
        'state': 'SOURCE_STAGED_UNVERIFIED',
        'type': source_type,
        'file_count': len(files),
        'sha256': digest.hexdigest(),
        'explicitly_not_verified': ['Sites source equivalence', 'Visual and interaction parity', 'Public backend access', 'Deployment', 'Custom domain'],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='.')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    code, report = inspect(Path(args.root))
    print(json.dumps(report, sort_keys=True, indent=2) if args.json else f"{report['state']}: {report.get('reason', '')}")
    return code


if __name__ == '__main__':
    raise SystemExit(main())
