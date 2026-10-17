"""Render thumbnails from the approved local brand recipe catalog."""

import hashlib
import json
import random
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring

CATALOG = json.loads(Path(__file__).with_suffix(".json").read_text(encoding="utf-8"))


def render_thumbnail(
    title: str,
    seed_text: str,
    motif_id: str | None = None,
    pair_index: int | None = None,
    variant: int | None = None,
) -> tuple[str, dict]:
    """Render a catalog motif; only the selected motif is model-controlled."""
    rng = random.Random(seed_text)
    motif = next((item for item in CATALOG["motifs"] if item["id"] == motif_id), None)
    if motif is None:
        motif = rng.choice(CATALOG["motifs"])
    if pair_index is None:
        pair_index = rng.randrange(len(CATALOG["pairs"]))
    if variant is None:
        variant = rng.randrange(len(motif["variants"]))
    if type(pair_index) is not int or not 0 <= pair_index < len(CATALOG["pairs"]):
        raise ValueError("Invalid thumbnail palette selection")
    if type(variant) is not int or not 0 <= variant < len(motif["variants"]):
        raise ValueError("Invalid thumbnail variant selection")

    pair = CATALOG["pairs"][pair_index]
    root = Element("svg", {
        "xmlns": "http://www.w3.org/2000/svg",
        "viewBox": "0 0 800 450",
        "width": "800",
        "height": "450",
    })
    SubElement(root, "rect", {"width": "800", "height": "450", "fill": pair["background"]})
    for shape in motif["variants"][variant]:
        attrs = dict(shape["attrs"])
        if shape["tag"] == "rect":
            for dimension, position in (("width", "x"), ("height", "y")):
                original = float(attrs[dimension])
                attrs[dimension] = original * rng.uniform(0.88, 1.12)
                attrs[position] = float(attrs[position]) + (original - attrs[dimension]) / 2
            attrs["rx"] = min(float(attrs["width"]), float(attrs["height"])) / 2
        elif shape["tag"] == "ellipse":
            attrs["rx"] = float(attrs["rx"]) * rng.uniform(0.9, 1.1)
            attrs["ry"] = float(attrs["ry"]) * rng.uniform(0.9, 1.1)
        elif shape["tag"] == "circle":
            attrs["r"] = float(attrs["r"]) * rng.uniform(0.85, 1.15)
        for key in ("x", "y", "cx", "cy"):
            if key in attrs:
                attrs[key] = float(attrs[key]) + rng.uniform(-12, 12)
        SubElement(root, shape["tag"], {
            **{key: f"{value:.2f}" if isinstance(value, float) else str(value)
               for key, value in attrs.items()},
            "fill": pair[shape["role"]],
        })

    svg = tostring(root, encoding="unicode") + "\n"
    metadata = {
        "catalog_version": CATALOG["version"],
        "seed": seed_text,
        "shape": motif["id"],
        "variant": variant,
        "pair_index": pair_index,
        "palette": {
            "background": pair["background"],
            "foreground": pair["ink"],
            "accent": pair["accent"],
        },
        "width": 800,
        "height": 450,
        "svg_hash": hashlib.sha256(svg.encode()).hexdigest()[:16],
    }
    return svg, metadata