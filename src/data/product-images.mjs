// Gallery order is editorial: the first image is the product's cover.
export function productImages(product, locale = 'ja') {
  if (product.images === undefined) {
    return [
      { src: product.image, alt: product.imageAlt, label: product.imageLabel },
    ];
  }
  if (!Array.isArray(product.images) || product.images.length === 0)
    throw new Error(`Product ${product.slug} needs at least one gallery image`);
  return product.images.map((image) => {
    if (
      !image ||
      typeof image.src !== 'string' ||
      !/^\/(?!\/)/.test(image.src) ||
      image.src.includes('\\') ||
      [...image.src].some(
        (character) =>
          character.codePointAt(0) <= 32 || character.codePointAt(0) === 127,
      ) ||
      typeof image.alt !== 'string' ||
      !image.alt.trim() ||
      typeof image.altEn !== 'string' ||
      !image.altEn.trim() ||
      (image.label !== undefined && typeof image.label !== 'string') ||
      (image.labelEn !== undefined && typeof image.labelEn !== 'string')
    )
      throw new Error(
        `Product ${product.slug} needs a local image path and Japanese/English alt text`,
      );
    return {
      src: image.src,
      alt: locale === 'en' ? image.altEn : image.alt,
      label: (locale === 'en' ? image.labelEn : image.label) || '',
    };
  });
}
