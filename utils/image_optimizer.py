from PIL import Image
import io

def optimize_image(image_bytes: bytes, max_size=(512, 512), quality=85) -> bytes:
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.thumbnail(max_size, Image.Resampling.LANCZOS)
        if img.mode != "RGB": img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        return buf.getvalue()
    except: return image_bytes
