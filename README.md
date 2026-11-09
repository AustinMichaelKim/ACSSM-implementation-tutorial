# ACSSM-implementation-tutorial
This repository is tutorial for non-official implementaiton of the paper "Amortized Control of Continuous State Space Feynman-Kac Model for Irregular Time Series" by Park et.al , ICLR 25


## References and Attribution

This repository contains independent educational implementations
and tutorials based on published research papers.

**Park, B., Lee, H., & Lee, J. (2025).**
*Amortized Control of Continuous State Space Feynman-Kac
Model for Irregular Time Series.*
ICLR 2025.
- [Original Paper](https://openreview.net/forum?id=8zJRon6k5v)
- [Official Implementation](https://github.com/bw-park/ACSSM)


Each tutorial notebook files includs:
- Mathematical explanations of the algorithms.
- Step-by-step pytorch implementations ( with simple examples )
- Code annotations and implementation notes

This tutorial is intended to make simple implementation and to dissect the main algorithm of the paper in more concise way.


## Current Implementation Step

1.[✅] **Data Generation for simple implementation _ OU process** 

    - Generate simple example data for tutorial

2.[✅] **Encoder and Transformer**

    - Encode the observed data to get the sampled latent observation.

    - Implement transformer to encodes the latent observation to get context vector.

3.[✅] **Local Linear Approximation model**

    - Model the linear SDE for the given process and implement neural net for drift and control

4.[❌] **Parellel Scan algorithm**

    - Implement efficient evaluation of the moments $m_t, \Sigma_t$ s.t $X_t \sim \mathcal{N}(m_t,\Sigma_t)$

5.[❌] **Optimizing ELBO and divergence**

    - Define the objective loss and optimize

6.[❌] **Result and apply**

    - Compare the result to the paper and apply to this algorithm to another dataset

## License

My original code, notebooks, and documentation in this repository
are licensed under the MIT License.
See [LICENSE](LICENSE).

Third-party materials, if any, remain subject to their
respective licenses.

