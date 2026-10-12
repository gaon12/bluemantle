"""Generate real, normalized embedding artifacts for any topic pack."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from vocabulary import prepare_pack, resolve_pack

ROOT = Path(__file__).resolve().parents[1]


def write_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", nargs="?", help="Pack directory or vocabulary TXT; optional with one active pack")
    parser.add_argument("--prepare-only", action="store_true", help="Deduplicate TXT without loading the model")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    if args.batch_size < 1 or args.threads < 1:
        parser.error("Batch size and thread count must be positive")
    try:
        pack, words_path = resolve_pack(args.pack)
        manifest, terms, report, words_hash = prepare_pack(pack, words_path)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    print(f"TXT: {report['uniqueWords']} unique words; {report['duplicatesRemoved']} duplicates removed", flush=True)
    if args.prepare_only:
        return
    config = manifest["embedding"]
    raw = (pack / manifest["terms"]).read_bytes()
    if not terms or len({t["id"] for t in terms}) != len(terms):
        raise SystemExit("Terms must be nonempty and have unique IDs")
    if config["inputMode"] not in {"name", "name-description"}:
        raise SystemExit("inputMode must be name or name-description")
    inputs = [t["label"] if config["inputMode"] == "name" or t["description"] == t["label"] else
              f"{t['label']}. {t['description']}" for t in terms]

    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(args.threads)
    # EmbeddingGemma 2 explicitly requires bf16 or fp32, never fp16.
    dtype = torch.bfloat16 if args.device.startswith("cuda") and torch.cuda.is_bf16_supported() else torch.float32
    model_args = {"revision": config.get("revision"), "device": args.device,
                  "model_kwargs": {"torch_dtype": dtype}}
    if config["model"] == "google/embeddinggemma-2":
        model_args["config_kwargs"] = {"vision_config": None, "audio_config": None}
    print(f"Loading {config['model']} ({args.device}, {dtype})", flush=True)
    model = SentenceTransformer(config["model"], **model_args)
    model.max_seq_length = config.get("maxTokens", 512)
    if config["prompt"] not in model.prompts:
        raise SystemExit(f"Unknown task prompt {config['prompt']}; available: {list(model.prompts)}")
    config_key = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    cache = ROOT / ".bluemantle/embedding-cache" / config_key
    cache.mkdir(parents=True, exist_ok=True)
    vectors = []
    for start in range(0, len(terms), args.batch_size):
        texts = inputs[start:start + args.batch_size]
        paths = [cache / (hashlib.sha256(text.encode()).hexdigest() + ".npy") for text in texts]
        pending = [i for i, path in enumerate(paths) if not path.exists()]
        if pending:
            encoded = model.encode([texts[i] for i in pending],
                batch_size=args.batch_size, prompt_name=config["prompt"],
                truncate_dim=config["dimensions"], normalize_embeddings=True,
                convert_to_numpy=True, show_progress_bar=False)
            for index, vector in zip(pending, encoded):
                vector = np.asarray(vector, dtype="<f4")
                if vector.shape != (config["dimensions"],) or not np.isfinite(vector).all() or np.linalg.norm(vector) < 1e-8:
                    raise SystemExit("Invalid model output; no artifact has been published")
                pending_path = paths[index].with_suffix('.npy.tmp')
                with pending_path.open('wb') as stream:
                    np.save(stream, vector, allow_pickle=False)
                os.replace(pending_path, paths[index])
        vectors.extend(np.load(path, allow_pickle=False) for path in paths)
        done = min(start + args.batch_size, len(terms))
        if done % 128 == 0 or done == len(terms):
            print(f"Embedded {done}/{len(terms)}", flush=True)
    matrix = np.asarray(vectors, dtype="<f4")
    if matrix.shape != (len(terms), config["dimensions"]) or not np.isfinite(matrix).all():
        raise SystemExit("Invalid cached vectors; clear embedding-cache and rebuild")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms < 1e-8):
        raise SystemExit("Zero vector in cache")
    matrix /= norms
    vector_bytes = matrix.tobytes()
    vector_hash = hashlib.sha256(vector_bytes).hexdigest()
    filename = f"vectors-{vector_hash[:16]}.f32"
    target = pack / filename
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(vector_bytes)
    os.replace(temporary, target)
    # Publish the index last. The game rejects stale terms/model/vector fingerprints.
    write_json(pack / manifest["embeddings"], {
        "schemaVersion": 1, "model": config["model"], "revision": config.get("revision"),
        "prompt": config["prompt"], "inputMode": config["inputMode"],
        "maxTokens": config.get("maxTokens", 512),
        "dimensions": config["dimensions"], "dtype": "float32-le",
        "termsSha256": hashlib.sha256(raw).hexdigest(),
        "vocabularySha256": words_hash,
        "vectorsSha256": vector_hash, "file": filename,
        "ids": [t["id"] for t in terms],
    })
    print(f"Ready: {len(terms)} terms x {config['dimensions']} dimensions; {target.name}", flush=True)


if __name__ == "__main__":
    main()
